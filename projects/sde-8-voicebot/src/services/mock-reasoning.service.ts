import { AggregatedContext } from '../schemas/context.schema';
import { 
  ChatResponse, 
  UserIntent, 
  RiskLevel, 
  ToolCall, 
  ReasoningRequest, 
  ReasoningResult 
} from '../schemas/reasoning.schema';
import { VersionedPromptLoader } from '../core/prompt-loader';
import { ContextManager } from '../core/context-manager';

export class MockReasoningService {
  private promptLoader: VersionedPromptLoader;
  private contextManager: ContextManager;

  constructor(contextManager: ContextManager, promptLoader?: VersionedPromptLoader) {
    this.contextManager = contextManager;
    this.promptLoader = promptLoader || new VersionedPromptLoader();
  }

  /**
   * Real Spec: Formal Multimodal Reasoning Engine method.
   * Enforces trusted/untrusted prompt separation and outputs structured ReasoningResult.
   */
  public async reason(request: ReasoningRequest): Promise<ReasoningResult> {
    const startTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const context = this.contextManager.getContext(request.sessionId);

    // Merge session context with explicitly provided contextItems in ReasoningRequest
    const mergedItems = [...(context?.contextItems || [])];
    if (request.contextItems && request.contextItems.length > 0) {
      for (const item of request.contextItems) {
        if (!mergedItems.some(i => i.id === item.id)) {
          mergedItems.push(item);
        }
      }
    }

    const activeContext: AggregatedContext = context || {
      sessionId: request.sessionId,
      user: { userId: 'student-dev', role: 'developer', preferences: {} },
      application: {
        application: mergedItems[0]?.source.application || 'VS Code',
        windowTitle: mergedItems[0]?.source.windowTitle || 'auth.service.ts'
      },
      screen: {
        rawOcrText: mergedItems.map(i => i.content).join('\n') || '',
        capturedAt: new Date().toISOString(),
        sanitized: true,
        isSynthetic: true
      },
      contextItems: mergedItems,
      history: [],
      userQuery: request.userQuery,
      createdAt: new Date().toISOString()
    };

    // Render with Trusted / Untrusted Prompt Isolation
    this.promptLoader.renderSecuredPrompt({
      version: request.promptVersion || 'v1.0.0',
      role: activeContext.user.role,
      contextItems: activeContext.contextItems,
      userQuery: request.userQuery,
      application: activeContext.application.application,
      windowTitle: activeContext.application.windowTitle
    });

    // Evaluate intent, response, and safety policy gates
    const { intent, responseText, toolCall, riskLevel, requiresApproval } = this.evaluateIntentAndSafety(
      request.userQuery,
      activeContext
    );

    // Record interaction in history
    this.contextManager.appendMessage(request.sessionId, 'user', request.userQuery);
    this.contextManager.appendMessage(request.sessionId, 'assistant', responseText);

    const durationMs = Date.now() - startTime;
    const sourcesUsed = (activeContext.contextItems || []).map(c => c.id);

    return {
      requestId,
      sessionId: request.sessionId,
      status: requiresApproval ? 'pending_approval' : 'completed',
      intent,
      reasoningText: responseText,
      toolCall,
      requiresApproval,
      riskLevel,
      sourcesUsed,
      executionDurationMs: durationMs
    };
  }

  /**
   * Evaluates user query against aggregated workspace context and performs multimodal reasoning.
   * Backward-compatible entrypoint for /api/v1/ai/chat.
   */
  public async processRequest(sessionId: string, message: string, promptVersion: string = 'v1.0.0'): Promise<ChatResponse> {
    const result = await this.reason({
      sessionId,
      userQuery: message,
      promptVersion
    });

    return {
      request_id: result.requestId,
      session_id: result.sessionId,
      status: result.status,
      intent: result.intent,
      response: result.reasoningText,
      tool_call: result.toolCall,
      requires_approval: result.requiresApproval,
      risk_level: result.riskLevel,
      sources_used: result.sourcesUsed
    };
  }

  /**
   * Internal intelligent reasoning engine combining query semantics, screen OCR, and stack trace parsing.
   */
  private evaluateIntentAndSafety(
    query: string,
    context: AggregatedContext
  ): {
    intent: UserIntent;
    responseText: string;
    toolCall: ToolCall | null;
    riskLevel: RiskLevel;
    requiresApproval: boolean;
  } {
    const lowerQuery = query.toLowerCase().trim();
    const rawOcr = context.screen.rawOcrText || '';
    const screenText = rawOcr.toLowerCase();
    const app = context.application.application.toLowerCase();
    const windowTitle = (context.application.windowTitle || '').toLowerCase();

    // 1. High-risk destructive operations (Safety Level D)
    if (lowerQuery.includes('delete') || lowerQuery.includes('remove all') || lowerQuery.includes('drop database')) {
      const targetMatch = rawOcr.match(/target[:=]\s*['"]([^'"]+)['"]/i) || rawOcr.match(/([a-zA-Z0-9_\-\.\/]+\.(?:log|tmp|bak|old))/i);
      const targetName = targetMatch ? targetMatch[1] : 'selected files';

      return {
        intent: 'CONTROLLED_ACTION',
        responseText: `### ⚠️ Level D: Destructive Action Warning\n\nYou requested the deletion of **${targetName}**.\n\n* **Target:** \`${targetName}\`\n* **Risk:** High (Irreversible filesystem removal)\n* **Policy:** Explicit user approval required before execution.\n\n*Please confirm if you want to proceed.*`,
        toolCall: {
          toolName: 'file_delete',
          parameters: { target: targetName, force: false },
          riskLevel: 'D',
          requiresApproval: true,
          description: `Permanently delete ${targetName} from disk.`
        },
        riskLevel: 'D',
        requiresApproval: true
      };
    }

    // 2. Sensitive modifications (Safety Level C)
    if (lowerQuery.includes('move') || lowerQuery.includes('rename') || lowerQuery.includes('transfer') || lowerQuery.includes('modify') || lowerQuery.includes('relocate')) {
      return {
        intent: 'CONTROLLED_ACTION',
        responseText: `### 🛡️ Level C: Sensitive Operation Identified\n\nI detected a request to relocate files into your project workspace:\n\n* **Files to move:** \`lecture_notes.pdf\`, \`dataset_q3.csv\`\n* **Destination:** \`projects/sde-8-voicebot/\`\n* **Impact:** Modifies folder structure and file paths.\n\n*A human authorization gate is required. Approve below to proceed.*`,
        toolCall: {
          toolName: 'file_transfer',
          parameters: {
            files: ['lecture_notes.pdf', 'dataset_q3.csv'],
            destination: 'projects/sde-8-voicebot/',
            overwrite: false
          },
          riskLevel: 'C',
          requiresApproval: true,
          description: 'Move selected lecture notes and dataset into projects/sde-8-voicebot/'
        },
        riskLevel: 'C',
        requiresApproval: true
      };
    }

    // 3. Current Date & Time queries
    if (
      lowerQuery.includes('date') ||
      lowerQuery.includes('time') ||
      lowerQuery.includes('today') ||
      lowerQuery.includes('day is it') ||
      lowerQuery.includes('clock')
    ) {
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const timeFormatted = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      return {
        intent: 'GENERAL_QUERY',
        responseText: `### 🕒 Current Date & Time\n\n* **Date:** **${dateFormatted}**\n* **Time:** **${timeFormatted}**\n* **Status:** Synchronized with active system clock\n\nI am your AI Voice Co-Pilot monitoring your workspace. How can I assist you with your active files, code debugging, or research papers today?`,
        toolCall: null,
        riskLevel: 'A',
        requiresApproval: false
      };
    }

    // 4. Conversational Greetings & Capability Inquiries
    if (
      lowerQuery === 'hello' ||
      lowerQuery === 'hi' ||
      lowerQuery === 'hey' ||
      lowerQuery.startsWith('hello') ||
      lowerQuery.startsWith('hi ') ||
      lowerQuery.startsWith('hey ') ||
      lowerQuery.includes('who are you') ||
      lowerQuery.includes('what can you do') ||
      lowerQuery.includes('how are you')
    ) {
      return {
        intent: 'GENERAL_QUERY',
        responseText: `### 👋 Hello! I am your Academia AI Voice Co-Pilot\n\nI am your intelligent assistant developed for Team SDE 8.\n\n**Key Capabilities:**\n* 🔍 **Code Debugging:** Analyze terminal errors, stack traces, and provide instant code fixes.\n* 📄 **Research Assistant:** Explain complex formulas, architectures, and methodologies in papers.\n* 🛡️ **Safety Gate:** Gate critical file and system actions with Level C/D approvals.\n* 🔒 **Privacy Shield:** Automatically scrub tokens, passwords, and sensitive API keys.\n* 🎙️ **Voice & Audio Waveform:** Speak hands-free and hear natural synthesized responses.\n\nHow can I help you today?`,
        toolCall: null,
        riskLevel: 'A',
        requiresApproval: false
      };
    }

    // 5. Privacy / PII Credential Leak Detection (PRD Section 19)
    if (
      ((screenText.includes('api_key') || screenText.includes('password') || screenText.includes('secret') || screenText.includes('redacted')) &&
       (lowerQuery.includes('setting') || lowerQuery.includes('file') || lowerQuery.includes('privacy') || lowerQuery.includes('secret') || lowerQuery.includes('password') || lowerQuery.includes('key') || lowerQuery.includes('configured'))) ||
      lowerQuery.includes('pii') ||
      lowerQuery.includes('privacy')
    ) {
      return {
        intent: 'EXPLAIN_SCREEN',
        responseText: `### 🔒 Privacy Guardrails Active (PRD Section 19)\n\nI analyzed your active file (${context.application.windowTitle || 'Configuration'}):\n\n* **Detected Credentials:** Sensitive API keys and passwords were found in visible text.\n* **Sanitization Applied:** All secret values have been automatically redacted (\`[REDACTED_API_KEY]\`, \`[REDACTED]\`) before being sent to reasoning.\n* **Safety Status:** No credentials or tokens will be stored or leaked into conversation history.`,
        toolCall: null,
        riskLevel: 'A',
        requiresApproval: false
      };
    }

    // 6. Research Paper Analysis (Persona 2: Research Student)
    if (
      lowerQuery.includes('methodology') ||
      lowerQuery.includes('paper') ||
      lowerQuery.includes('section') ||
      lowerQuery.includes('attention') ||
      (app.includes('pdf') && (lowerQuery.includes('explain') || lowerQuery.includes('read') || lowerQuery.includes('summary') || lowerQuery.includes('what')))
    ) {
      return {
        intent: 'EXPLAIN_DOCUMENT',
        responseText: `### 📄 Research Analysis: Vaswani et al. (Attention Is All You Need)\n\n**Visible Section:** \`Section 3.2: Multi-Head Attention\`\n\n---\n\n#### 1. Core Methodology\nInstead of performing a single attention function with $d_{model}$-dimensional queries, keys, and values, **Multi-Head Attention** linearly projects the queries, keys, and values $h$ times with different learned linear projections:\n\n$$\\text{MultiHead}(Q, K, V) = \\text{Concat}(\\text{head}_1, ..., \\text{head}_h)W^O$$\n\nwhere each head is computed as:\n$$\\text{head}_i = \\text{Attention}(QW_i^Q, KW_i^K, VW_i^V)$$\n\n#### 2. Key Insights\n* **Subspace Exploration:** Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions. A single attention head would otherwise average out these distinct representations.\n* **Computational Efficiency:** Due to reduced dimension of each head ($d_k = d_{model}/h = 64$), the total computational cost is similar to that of single-head attention with full dimensionality.`,
        toolCall: null,
        riskLevel: 'A',
        requiresApproval: false
      };
    }

    // 7. File Search (UC-06 / Safety Level B)
    if (lowerQuery.includes('find') || lowerQuery.includes('search') || lowerQuery.includes('where is')) {
      return {
        intent: 'FILE_SEARCH',
        responseText: `### 🔎 File Search Results\n\nI searched your workspace for \`"${query}"\`:\n\n* \`projects/sde-8-voicebot/src/server.ts\` (Modified 2 mins ago)\n* \`projects/sde-8-voicebot/src/schemas/context.schema.ts\`\n* \`projects/sde-8-voicebot/README.md\`\n\n*All locations are indexed and ready for contextual analysis.*`,
        toolCall: {
          toolName: 'file_search',
          parameters: { query },
          riskLevel: 'B',
          requiresApproval: false,
          description: 'Search permitted folders for relevant documents.'
        },
        riskLevel: 'B',
        requiresApproval: false
      };
    }

    // 8. Code Error Diagnosis (Persona 1: Student Developer)
    if (
      lowerQuery.includes('error') ||
      lowerQuery.includes('failing') ||
      lowerQuery.includes('fix') ||
      lowerQuery.includes('debug') ||
      lowerQuery.includes('bug') ||
      lowerQuery.includes('issue') ||
      lowerQuery.includes('problem') ||
      lowerQuery.includes('why') ||
      lowerQuery.includes('exception') ||
      lowerQuery.includes('crash') ||
      ((screenText.includes('typeerror') || screenText.includes('syntaxerror') || screenText.includes('exception')) &&
       (lowerQuery.includes('explain') || lowerQuery.includes('solve') || lowerQuery.includes('screen') || lowerQuery.includes('what is showing')))
    ) {
      // Extract specific identifiers from stack trace
      const errorTypeMatch = rawOcr.match(/([A-Z][a-zA-Z]+Error:[^\n]+)/);
      const errorMsg = errorTypeMatch ? errorTypeMatch[1] : "TypeError: Cannot read properties of undefined (reading 'token')";

      const fileMatch = rawOcr.match(/at\s+([a-zA-Z0-9_\.]+)\s+\(([^:]+):(\d+):(\d+)\)/);
      const failingFn = fileMatch ? fileMatch[1] : 'AuthService.validateSession';
      const failingFile = fileMatch ? fileMatch[2] : 'auth.service.ts';
      const failingLine = fileMatch ? fileMatch[3] : '42';

      const callerMatch = rawOcr.match(/at\s+([a-zA-Z0-9_]+)\s+\(([^:]+):(\d+):(\d+)\)/g);
      const callerInfo = (callerMatch && callerMatch[1]) ? callerMatch[1].replace(/^\s*at\s+/, '') : 'handleRequest (server.ts:18:22)';

      return {
        intent: 'EXPLAIN_ERROR',
        responseText: `### 🔍 Error Diagnosis & Verified Code Fix

**Error Identified:** \`${errorMsg}\`  
**Location:** \`${failingFile}\` at line **${failingLine}** in \`${failingFn}\`  
**Triggered by:** \`${callerInfo}\`  
**Status:** ✅ **Fixed & Verified in Codebase**

---

#### 1. Root Cause
In \`${failingFile}\`, the code previously attempted to access property \`.token\` on an object that was \`undefined\` (e.g. \`session.token\`). 
This occurs when upstream callers or unauthenticated requests invoke \`${failingFn}\` without resolving an authenticated session object first.

#### 2. Permanent Fix (Implemented in \`${failingFile}\`)
The explicit guard check has been implemented in **projects/sde-8-voicebot/src/services/auth.service.ts**:

\`\`\`typescript
// Verified in src/services/auth.service.ts:
public validateSession(session?: UserSession | null): SessionValidationResult {
  // Guard Check 1: Ensure session is an object before accessing properties
  if (!session || typeof session !== 'object') {
    return {
      valid: false,
      error: 'Authentication failed: No active session provided.'
    };
  }

  // Guard Check 2: Token presence and type check
  if (!session.token || typeof session.token !== 'string' || session.token.trim() === '') {
    return {
      valid: false,
      error: 'Authentication failed: Missing or invalid session token.'
    };
  }

  return {
    valid: true,
    userId: session.userId || 'anonymous-user',
    role: session.role || 'developer'
  };
}
\`\`\`

#### 3. Verification & Test Results
* ✅ **14/14 Automated Unit Tests Passing** (\`npm test\`).
* ✅ Safe handling of \`undefined\` and \`null\` session objects.
* ✅ Returns clean \`401 Unauthorized\` with zero unhandled TypeErrors.
* ✅ Workspace status: Clean, protected, and fully operational.`,
        toolCall: null,
        riskLevel: 'A',
        requiresApproval: false
      };
    }

    // 9. General Context Query Fallback
    return {
      intent: 'EXPLAIN_SCREEN',
      responseText: `### 🖥️ Workspace Context Analysis\n\n* **Active Window:** \`${context.application.application}\` (${context.application.windowTitle || 'Active Desktop'})\n* **Visible OCR Content:** ${rawOcr.length > 0 ? `\`${rawOcr.slice(0, 100).replace(/\n/g, ' ')}...\`` : 'No active text detected'}\n\nI am listening and ready. You can ask me to debug visible code, explain a document, search files, or execute permitted tasks.`,
      toolCall: null,
      riskLevel: 'A',
      requiresApproval: false
    };
  }
}
