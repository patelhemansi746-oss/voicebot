import { ContextManager } from '../src/core/context-manager';
import { VersionedPromptLoader } from '../src/core/prompt-loader';
import { MockReasoningService } from '../src/services/mock-reasoning.service';
import { AggregatedContextSchema } from '../src/schemas/context.schema';

describe('Team SDE 8 — Context & Reasoning Engine Test Suite', () => {
  let contextManager: ContextManager;
  let promptLoader: VersionedPromptLoader;
  let reasoningService: MockReasoningService;

  beforeEach(() => {
    contextManager = new ContextManager(5);
    promptLoader = new VersionedPromptLoader();
    reasoningService = new MockReasoningService(contextManager, promptLoader);
  });

  describe('Context Sanitization & Privacy (PRD Section 19)', () => {
    it('should redact OpenAI style API keys from OCR content', () => {
      const leaked = 'Connecting to api with key sk-abcdef1234567890abcdef1234567890';
      const clean = contextManager.sanitize(leaked);
      expect(clean).not.toContain('abcdef1234567890');
      expect(clean).toContain('[REDACTED_API_KEY]');
    });

    it('should redact Bearer authorization tokens', () => {
      const leaked = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
      const clean = contextManager.sanitize(leaked);
      expect(clean).toContain('Bearer [REDACTED_TOKEN]');
    });

    it('should redact inline passwords', () => {
      const leaked = 'DB_CONFIG = { password: "superSecretDBPassword" }';
      const clean = contextManager.sanitize(leaked);
      expect(clean).toContain('password="[REDACTED]"');
    });
  });

  describe('Context Schema Validation (Zod)', () => {
    it('should validate valid aggregated context', () => {
      const validPayload = {
        sessionId: 'session-001',
        user: { userId: 'u123', role: 'developer' },
        application: { application: 'VS Code', windowTitle: 'main.py' },
        screen: {
          rawOcrText: 'SyntaxError: invalid syntax',
          capturedAt: new Date().toISOString(),
          sanitized: true
        },
        history: [],
        userQuery: 'Fix this code',
        createdAt: new Date().toISOString()
      };

      const parsed = AggregatedContextSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it('should reject invalid aggregated context missing required fields', () => {
      const invalidPayload = {
        sessionId: 'session-001'
        // Missing user, application, etc.
      };

      const parsed = AggregatedContextSchema.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Versioned Prompt Management', () => {
    it('should successfully render v1.0.0 prompt with persona developer', () => {
      const prompt = promptLoader.renderPrompt({
        version: 'v1.0.0',
        role: 'developer',
        variables: {
          active_application: 'VS Code',
          window_title: 'app.ts',
          screen_context: 'TypeError: undefined is not a function',
          conversation_history: 'None',
          user_query: 'Why is it failing?'
        }
      });

      expect(prompt).toContain('Academia AI Voice Co-Pilot');
      expect(prompt).toContain('Persona: Student Developer');
      expect(prompt).toContain('VS Code');
      expect(prompt).toContain('Why is it failing?');
    });

    it('should fallback gracefully to v1.0.0 when unknown version is requested', () => {
      const prompt = promptLoader.renderPrompt({
        version: 'v9.9.9-unknown',
        role: 'general',
        variables: {
          active_application: 'Finder',
          window_title: 'Home',
          screen_context: 'empty',
          conversation_history: 'None',
          user_query: 'Help me'
        }
      });

      expect(prompt).toContain('Academia AI Voice Co-Pilot');
    });
  });

  describe('Mock Reasoning Service & Safety Gate (SDD Page 5 & 6)', () => {
    it('should classify coding error as Level A (Informational, no approval required)', async () => {
      const sessionId = 'test-session-dev';
      contextManager.updateContext(
        sessionId,
        { userId: 'dev-1', role: 'developer', preferences: {} },
        { application: 'VS Code', windowTitle: 'index.ts' },
        { rawOcrText: 'TypeError: Cannot read properties of undefined', capturedAt: new Date().toISOString() },
        'Why is this failing?'
      );

      const response = await reasoningService.processRequest(sessionId, 'Why is this failing?');
      expect(response.intent).toBe('EXPLAIN_ERROR');
      expect(response.risk_level).toBe('A');
      expect(response.requires_approval).toBe(false);
      expect(response.status).toBe('completed');
    });

    it('should gate file modification with Level C (Requires user approval)', async () => {
      const sessionId = 'test-session-move';
      contextManager.updateContext(
        sessionId,
        { userId: 'user-2', role: 'general', preferences: {} },
        { application: 'File Explorer' },
        { rawOcrText: 'report.pdf', capturedAt: new Date().toISOString() },
        'Move these files'
      );

      const response = await reasoningService.processRequest(sessionId, 'Move these files into project folder');
      expect(response.intent).toBe('CONTROLLED_ACTION');
      expect(response.risk_level).toBe('C');
      expect(response.requires_approval).toBe(true);
      expect(response.status).toBe('pending_approval');
      expect(response.tool_call).not.toBeNull();
      expect(response.tool_call?.toolName).toBe('file_transfer');
    });

    it('should gate destructive deletion with Level D (Mandatory confirmation)', async () => {
      const sessionId = 'test-session-delete';
      contextManager.updateContext(
        sessionId,
        { userId: 'user-3', role: 'general', preferences: {} },
        { application: 'Terminal' },
        { rawOcrText: 'old_builds/', capturedAt: new Date().toISOString() },
        'Delete these files'
      );

      const response = await reasoningService.processRequest(sessionId, 'Delete all old builds');
      expect(response.intent).toBe('CONTROLLED_ACTION');
      expect(response.risk_level).toBe('D');
      expect(response.requires_approval).toBe(true);
      expect(response.status).toBe('pending_approval');
      expect(response.tool_call?.toolName).toBe('file_delete');
    });
  });
});

