import { describe, it, expect, vi } from 'vitest';
import { ErrorRecoveryEngine } from '../src/recovery/ErrorRecoveryEngine.js';
import { WorkflowContext, WorkflowStep, StepType } from '../src/types/workflow.js';
import { RetryPolicy } from '../src/types/error-recovery.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';

function createMockContext(): WorkflowContext {
  return {
    workflowId: 'wf_err_test',
    name: 'Error Recovery Test',
    userRequest: {
      requestId: 'r1',
      sessionId: 's1',
      timestamp: Date.now(),
    },
    appContext: {},
    stepResults: {},
    variables: { tempFilePath: '/tmp/test_scratch.tmp' },
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('ErrorRecoveryEngine', () => {
  it('should retry operation with exponential backoff and succeed', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();
    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoffMs: 20,
      backoffMultiplier: 1.5,
    };

    let attemptCount = 0;
    const retrySpy = vi.fn();
    engine.on('retryAttempt', retrySpy);

    const result = await engine.executeWithRetry(
      async (attempt) => {
        attemptCount++;
        if (attempt < 3) {
          throw new Error(`Transient error on attempt ${attempt}`);
        }
        return 'SUCCESS_DATA';
      },
      policy,
      ctx,
      'step_test'
    );

    expect(result).toBe('SUCCESS_DATA');
    expect(attemptCount).toBe(3);
    expect(retrySpy).toHaveBeenCalledTimes(2);
    expect(ctx.attemptsPerStep.step_test).toBe(3);
  });

  it('should exhaust retries and throw final error when maxAttempts reached', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();
    const policy: RetryPolicy = {
      maxAttempts: 2,
      backoffMs: 10,
      backoffMultiplier: 2,
    };

    await expect(
      engine.executeWithRetry(
        async () => {
          throw new Error('Persistent failure');
        },
        policy,
        ctx,
        'step_fail'
      )
    ).rejects.toThrow('Persistent failure');

    expect(ctx.attemptsPerStep.step_fail).toBe(2);
  });

  it('should not retry if error code is not in retryableErrorCodes list', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();
    const policy: RetryPolicy = {
      maxAttempts: 4,
      backoffMs: 10,
      backoffMultiplier: 2,
      retryableErrorCodes: ['NETWORK_TIMEOUT', 'GATEWAY_ERROR'],
    };

    let executions = 0;
    await expect(
      engine.executeWithRetry(
        async () => {
          executions++;
          const err = new Error('Invalid Auth credentials');
          (err as { code?: string }).code = 'AUTH_UNAUTHORIZED';
          throw err;
        },
        policy,
        ctx,
        'step_auth'
      )
    ).rejects.toThrow('Invalid Auth credentials');

    expect(executions).toBe(1); // Aborted on 1st attempt
  });

  it('should handle fallback strategies (ALTERNATIVE_STEP, DEFAULT_OUTPUT, ASK_USER)', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();

    // 1. ALTERNATIVE_STEP
    const stepAlt: WorkflowStep = {
      id: 'step_primary',
      name: 'Primary Search',
      type: StepType.TOOL_EXECUTION,
      description: 'Search',
      fallbackAction: {
        type: 'ALTERNATIVE_STEP',
        fallbackStepId: 'step_cached_search',
      },
    };
    const resAlt = await engine.handleFallback(stepAlt, new Error('Search failed'), ctx);
    expect(resAlt.handled).toBe(true);
    expect(resAlt.nextStepId).toBe('step_cached_search');

    // 2. DEFAULT_OUTPUT
    const stepDef: WorkflowStep = {
      id: 'step_summary',
      name: 'Summarize',
      type: StepType.TOOL_EXECUTION,
      description: 'Summarize',
      fallbackAction: {
        type: 'DEFAULT_OUTPUT',
        defaultOutput: { summary: ['Fallback generic summary'] },
      },
    };
    const resDef = await engine.handleFallback(stepDef, new Error('LLM rate limit'), ctx);
    expect(resDef.handled).toBe(true);
    expect(resDef.output).toEqual({ summary: ['Fallback generic summary'] });

    // 3. ASK_USER
    const stepAsk: WorkflowStep = {
      id: 'step_clarify',
      name: 'Analyze Document',
      type: StepType.TOOL_EXECUTION,
      description: 'Analyze',
      fallbackAction: {
        type: 'ASK_USER',
        clarificationPrompt: 'Multiple files found. Which one do you prefer?',
      },
    };
    const resAsk = await engine.handleFallback(stepAsk, new Error('Ambiguous file'), ctx);
    expect(resAsk.handled).toBe(true);
    expect(resAsk.clarificationPrompt).toBe('Multiple files found. Which one do you prefer?');
  });

  it('should execute Saga compensation rollback in reverse LIFO order', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();
    const executor = new MockToolExecutor();
    const executionOrder: string[] = [];

    executor.configureMock('file_delete', {
      mockHandler: (params) => {
        executionOrder.push(String(params.filePath));
        return { deleted: true };
      },
    });

    const compensations = [
      {
        id: 'comp_1',
        description: 'Delete first temp artifact',
        toolName: 'file_delete',
        parameters: { filePath: '/tmp/first.tmp' },
        runOnFailureOnly: true,
      },
      {
        id: 'comp_2',
        description: 'Delete second temp artifact',
        toolName: 'file_delete',
        parameters: (c: WorkflowContext) => ({ filePath: String(c.variables.tempFilePath) }),
        runOnFailureOnly: true,
      },
    ];

    await engine.executeCompensations(compensations, ctx, executor);

    // Should execute comp_2 first, then comp_1 (LIFO)
    expect(executionOrder).toEqual(['/tmp/test_scratch.tmp', '/tmp/first.tmp']);
  });

  it('should handle compensation tool failures and emit compensationFailed event', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();
    const executor = new MockToolExecutor();

    executor.configureMock('file_delete', {
      failNTimes: 5,
      failureErrorMessage: 'Simulated file delete permission denied',
    });

    const failedSpy = vi.fn();
    engine.on('compensationFailed', failedSpy);

    const compensations = [
      {
        id: 'comp_fail',
        description: 'Failed compensation',
        toolName: 'file_delete',
        parameters: { filePath: '/protected/root.bin' },
        runOnFailureOnly: true,
      },
    ];

    await engine.executeCompensations(compensations, ctx, executor);
    expect(failedSpy).toHaveBeenCalledTimes(1);

    // Empty compensations does nothing
    await engine.executeCompensations([], ctx, executor);
  });

  it('should handle fallback edge cases', async () => {
    const engine = new ErrorRecoveryEngine();
    const ctx = createMockContext();

    // No fallback action
    const stepNoFallback: WorkflowStep = {
      id: 's_none',
      name: 'No Fallback',
      type: StepType.OBSERVATION,
      description: 'None',
    };
    const resNone = await engine.handleFallback(stepNoFallback, new Error('Boom'), ctx);
    expect(resNone.handled).toBe(false);

    // ALTERNATIVE_STEP without fallbackStepId
    const stepBrokenAlt: WorkflowStep = {
      id: 's_broken',
      name: 'Broken Alt',
      type: StepType.TOOL_EXECUTION,
      description: 'Broken',
      fallbackAction: {
        type: 'ALTERNATIVE_STEP',
      },
    };
    await expect(engine.handleFallback(stepBrokenAlt, new Error('Boom'), ctx)).rejects.toThrow();

    // Fallback ABORT
    const stepAbort: WorkflowStep = {
      id: 's_abort',
      name: 'Abort',
      type: StepType.TOOL_EXECUTION,
      description: 'Abort',
      fallbackAction: {
        type: 'ABORT',
      },
    };
    const resAbort = await engine.handleFallback(stepAbort, new Error('Boom'), ctx);
    expect(resAbort.strategy).toBe('ABORT');
  });
});
