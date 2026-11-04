import { describe, it, expect } from 'vitest';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { RiskLevel } from '../src/types/safety.js';
import { ToolExecutionRequest } from '../src/types/tool.js';

describe('MockToolExecutor and ToolRegistry', () => {
  it('should load all built-in tools and validate registrations', () => {
    const executor = new MockToolExecutor();
    const tools = executor.listTools();

    // Exactly 2 harmless built-in tools
    expect(tools.length).toBe(2);
    expect(executor.getTool('calculator')).toBeDefined();
    expect(executor.getTool('summarize_text')).toBeDefined();
  });

  it('should execute standard tool with valid parameters successfully', async () => {
    const executor = new MockToolExecutor();
    const req: ToolExecutionRequest = {
      requestId: 'req_1',
      workflowId: 'wf_1',
      stepId: 'step_1',
      toolName: 'calculator',
      parameters: { expression: '15 + 25' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    };

    const res = await executor.execute<{ expression: string; result: number }>(req);

    expect(res.success).toBe(true);
    expect(res.data?.result).toBe(40);
    expect(executor.getExecutionHistory().length).toBe(1);
  });

  it('should fail with PARAM_VALIDATION_ERROR when required parameters are missing', async () => {
    const executor = new MockToolExecutor();
    const req: ToolExecutionRequest = {
      requestId: 'req_2',
      workflowId: 'wf_1',
      stepId: 'step_2',
      toolName: 'calculator',
      parameters: {}, // missing required expression
      riskLevel: RiskLevel.A_INFORMATIONAL,
    };

    const res = await executor.execute(req);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PARAM_VALIDATION_ERROR');
    expect(res.error?.message).toContain("Missing required parameter 'expression'");
  });

  it('should fail with PARAM_VALIDATION_ERROR on type mismatch', async () => {
    const executor = new MockToolExecutor();
    const req: ToolExecutionRequest = {
      requestId: 'req_3',
      workflowId: 'wf_1',
      stepId: 'step_3',
      toolName: 'summarize_text',
      parameters: { text: 12345 as unknown as string }, // text must be string
      riskLevel: RiskLevel.A_INFORMATIONAL,
    };

    const res = await executor.execute(req);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('PARAM_VALIDATION_ERROR');
    expect(res.error?.message).toContain("expected type 'string'");
  });

  it('should simulate transient failures with failNTimes counter', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', {
      failNTimes: 2,
      failureErrorCode: 'TRANSIENT_GATEWAY_TIMEOUT',
      failureErrorMessage: 'Simulated 504 Gateway Timeout',
    });

    const createReq = (id: string): ToolExecutionRequest => ({
      requestId: id,
      workflowId: 'wf_test',
      stepId: 'step_summary',
      toolName: 'summarize_text',
      parameters: { text: 'Testing transient state machine error handling' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });

    // 1st attempt -> Fails
    const res1 = await executor.execute(createReq('r1'));
    expect(res1.success).toBe(false);
    expect(res1.error?.code).toBe('TRANSIENT_GATEWAY_TIMEOUT');

    // 2nd attempt -> Fails
    const res2 = await executor.execute(createReq('r2'));
    expect(res2.success).toBe(false);

    // 3rd attempt -> Succeeds!
    const res3 = await executor.execute(createReq('r3'));
    expect(res3.success).toBe(true);
    expect(res3.data).toBeDefined();
  });

  it('should simulate tool timeout', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('calculator', {
      simulateTimeout: true,
    });

    const res = await executor.execute({
      requestId: 'r_timeout',
      workflowId: 'wf_1',
      stepId: 's1',
      toolName: 'calculator',
      parameters: { expression: '100 * 2' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('TOOL_TIMEOUT');
    expect(res.error?.isRetryable).toBe(true);
  });

  it('should support custom mock handler override', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('calculator', {
      mockHandler: (params) => {
        return { customComputed: true, expr: params.expression, val: 42 };
      },
    });

    const res = await executor.execute<{ customComputed: boolean; val: number }>({
      requestId: 'r_calc',
      workflowId: 'wf_1',
      stepId: 's1',
      toolName: 'calculator',
      parameters: { expression: '10 + 32' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });

    expect(res.success).toBe(true);
    expect(res.data?.customComputed).toBe(true);
    expect(res.data?.val).toBe(42);
  });

  it('should simulate latency delays', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', {
      simulatedLatencyMs: 30,
    });

    const t0 = Date.now();
    await executor.execute({
      requestId: 'r_lat',
      workflowId: 'wf_1',
      stepId: 's1',
      toolName: 'summarize_text',
      parameters: { text: 'Sample text to summarize with delay' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeGreaterThanOrEqual(25);
  });

  it('should test ToolRegistry methods and error conditions', () => {
    const registry = new ToolRegistry(false);
    expect(registry.has('non_existent')).toBe(false);
    expect(() => registry.require('non_existent')).toThrow();
  });

  it('should cover all default mock handlers for the two harmless tools', async () => {
    const executor = new MockToolExecutor();

    // 1. Calculator default handler
    const rCalc = await executor.execute({
      requestId: 'r_calc_default',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'calculator',
      parameters: { expression: '5 * 8' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rCalc.success).toBe(true);

    // 2. Summarize text default handler
    const rSumm = await executor.execute({
      requestId: 'r_summ_default',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'summarize_text',
      parameters: { text: 'Antigravity AI Agent Framework and tooling' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rSumm.success).toBe(true);

    // Clear history & reset mocks
    executor.clearHistory();
    expect(executor.getExecutionHistory().length).toBe(0);
    executor.resetMocks();
    expect(executor.getRegistry()).toBeDefined();
  });

  it('should test latency min/max range, failureRate, and exception handling', async () => {
    const executor = new MockToolExecutor();

    // 1. Min/Max Latency Range
    executor.configureMock('calculator', {
      simulatedLatencyMs: { min: 2, max: 6 },
    });
    const rLatency = await executor.execute({
      requestId: 'r_range',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'calculator',
      parameters: { expression: '2 + 3' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rLatency.success).toBe(true);

    // 2. Probabilistic failureRate = 1.0
    executor.configureMock('summarize_text', {
      failureRate: 1.0,
      failureErrorCode: 'PROB_ERROR',
      failureErrorMessage: 'Random crash',
    });
    const rProb = await executor.execute({
      requestId: 'r_prob',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'summarize_text',
      parameters: { text: 'test content' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rProb.success).toBe(false);
    expect(rProb.error?.code).toBe('PROB_ERROR');

    // 3. Exception in mockHandler
    executor.configureMock('calculator', {
      mockHandler: () => {
        throw new Error('Fatal computation error');
      },
    });
    const rException = await executor.execute({
      requestId: 'r_exc',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'calculator',
      parameters: { expression: '1 + 1' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rException.success).toBe(false);
    expect(rException.error?.code).toBe('EXECUTION_EXCEPTION');

    // 4. Reset mocks and test invalid calculator expression
    executor.resetMocks();
    const rInvalidCalc = await executor.execute<{ result: number }>({
      requestId: 'r_inv_calc',
      workflowId: 'wf',
      stepId: 's',
      toolName: 'calculator',
      parameters: { expression: '++invalid++' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    expect(rInvalidCalc.success).toBe(true);
    expect(rInvalidCalc.data?.result).toBe(0);

    // 5. Register custom ToolSpec
    executor.registerTool(
      {
        name: 'custom_echo',
        description: 'Echo',
        purpose: 'Testing',
        parameters: { type: 'object', properties: { msg: { type: 'string', description: 'm' } } },
        riskLevel: RiskLevel.A_INFORMATIONAL,
        failureBehavior: 'ABORT',
      },
      {
        mockHandler: (p) => ({ echo: p.msg }),
      }
    );
    expect(executor.getTool('custom_echo')).toBeDefined();
  });
});
