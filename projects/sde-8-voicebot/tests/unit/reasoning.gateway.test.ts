import { ReasoningGateway } from '../../src/gateways/reasoning.gateway';
import { TranscriptionResult } from '../../src/types/gateway.types';
import { SessionContext } from '../../src/types/session.types';

describe('ReasoningGateway Unit Tests', () => {
  let gateway: ReasoningGateway;

  const baseTranscription = (text: string): TranscriptionResult => ({
    transcriptId: 'tr-01',
    audioId: 'aud-01',
    text,
    confidence: 0.95,
    detectedLanguage: 'en-US',
    durationMs: 50,
    timestamp: new Date().toISOString()
  });

  const baseContext: SessionContext = {
    activeApplication: 'VSCode',
    windowTitle: 'main.ts',
    documentType: 'typescript',
    visibleContentSnippet: 'const x = 1;',
    lastUpdated: new Date().toISOString()
  };

  beforeEach(() => {
    gateway = new ReasoningGateway();
  });

  it('should detect calculation intent and map to calculator tool', async () => {
    const res = await gateway.reason(baseTranscription('Please calculate 50 * 4 + 20'), baseContext);

    expect(res.intent).toBe('EXECUTE_TOOL');
    expect(res.toolRequired).toBeDefined();
    expect(res.toolRequired?.toolName).toBe('calculator');
    expect(res.toolRequired?.riskLevel).toBe('A_INFORMATIONAL');
    expect(res.toolRequired?.requiresApproval).toBe(false);
  });

  it('should detect file search intent and map to file_search tool', async () => {
    const res = await gateway.reason(baseTranscription('Find project report'), baseContext);

    expect(res.intent).toBe('EXECUTE_TOOL');
    expect(res.toolRequired?.toolName).toBe('file_search');
    expect(res.toolRequired?.riskLevel).toBe('B_LOW_RISK');
    expect(res.toolRequired?.requiresApproval).toBe(false);
  });

  it('should detect sensitive file modification and require approval (Category C)', async () => {
    const res = await gateway.reason(baseTranscription('Please modify notes.txt and save file'), baseContext);

    expect(res.intent).toBe('EXECUTE_TOOL');
    expect(res.toolRequired?.toolName).toBe('file_writer');
    expect(res.toolRequired?.riskLevel).toBe('C_SENSITIVE');
    expect(res.toolRequired?.requiresApproval).toBe(true);
  });

  it('should detect code explanation intent from screen context', async () => {
    const res = await gateway.reason(baseTranscription('Explain the error on screen'), baseContext);

    expect(res.intent).toBe('EXPLAIN_CODE');
    expect(res.toolRequired).toBeUndefined();
    expect(res.suggestedResponse).toContain('Analysis of main.ts');
  });

  it('should handle general conversation', async () => {
    const res = await gateway.reason(baseTranscription('Hello voicebot'), baseContext);

    expect(res.intent).toBe('GENERAL_CONVERSATION');
    expect(res.suggestedResponse).toContain('Hello voicebot');
  });

  it('should parse math expression without calculate prefix', async () => {
    const res = await gateway.reason(baseTranscription('what is 50 + 25'), baseContext);
    expect(res.intent).toBe('EXECUTE_TOOL');
    expect(res.toolRequired?.parameters?.expression).toContain('50 + 25');
  });

  it('should report module health and support setStatus', () => {
    const health = gateway.getHealth();
    expect(health.module).toBe('reasoning');
    expect(health.status).toBe('UP');

    gateway.setStatus('DOWN');
    expect(gateway.getHealth().status).toBe('DOWN');
  });
});
