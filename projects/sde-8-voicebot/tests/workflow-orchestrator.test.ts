import { describe, it, expect, vi } from 'vitest';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import {
  createCalculationAndSummaryWorkflow,
  createControlledActionWorkflow,
  createTextAnalysisWorkflow,
  createPdfSummarizeWorkflow,
  createControlledFileCleanupWorkflow,
  createCodeErrorDiagnosisWorkflow,
} from '../src/workflows/predefined-workflows.js';
import { WorkflowContext, WorkflowState } from '../src/types/workflow.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import { RiskLevel } from '../src/types/safety.js';

function createTestContext(workflowId: string): WorkflowContext {
  return {
    workflowId,
    name: 'Integration Test Context',
    userRequest: {
      requestId: `req_${workflowId}`,
      sessionId: 'sess_test',
      rawVoiceInput: 'Calculate metrics and synthesize summary report',
      intent: 'calc_and_summarize',
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'Voicebot Workspace',
      visibleContent: 'Metrics and data ready for analysis',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('WorkflowOrchestrator Integration', () => {
  it('should successfully orchestrate multi-step Calculation & Summarization workflow', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);
    const plan = createCalculationAndSummaryWorkflow();
    const context = createTestContext('wf_calc_summarize_test');

    const stateTransitions: string[] = [];
    orchestrator.on('stateTransition', (data) => {
      stateTransitions.push(`${data.from}->${data.to}`);
    });

    const result = await orchestrator.executeWorkflow(plan, context);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(WorkflowState.COMPLETED);
    expect(result.executedSteps).toContain('step_calc');
    expect(result.executedSteps).toContain('step_summarize');

    // Context variable assertions
    expect(context.variables.calcResult).toBeDefined();
    expect(context.variables.summaryReport).toBeDefined();
    expect(stateTransitions.length).toBeGreaterThan(5);
  });

  it('should pause in AWAITING_APPROVAL for Level D action and proceed on approval', async () => {
    const executor = new MockToolExecutor();
    const safetyGate = new SafetyGate();
    const orchestrator = new WorkflowOrchestrator(executor, safetyGate);
    const plan = createControlledActionWorkflow();
    const context = createTestContext('wf_action_approved');

    // Listen for approval requested
    orchestrator.on('approvalRequested', (approvalReq) => {
      expect(approvalReq.riskLevel).toBe(RiskLevel.D_HIGH_RISK_DESTRUCTIVE);
      expect(approvalReq.stepId).toBe('step_action');

      // Async simulate user approval after small delay
      setTimeout(() => {
        orchestrator.submitApproval(approvalReq.stepId, true, 'User confirmed action authorization');
      }, 20);
    });

    const result = await orchestrator.executeWorkflow(plan, context);

    expect(result.success).toBe(true);
    expect(result.finalState).toBe(WorkflowState.COMPLETED);
    expect(result.executedSteps).toContain('step_action');
    expect(safetyGate.isStepApproved('wf_action_approved', 'step_action')).toBe(true);
  });

  it('should handle rejection at safety gate and utilize fallback output', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);
    const plan = createControlledActionWorkflow();
    const context = createTestContext('wf_action_rejected');

    orchestrator.on('approvalRequested', (approvalReq) => {
      // User denies approval
      setTimeout(() => {
        orchestrator.submitApproval(approvalReq.stepId, false, 'User denied authorization');
      }, 15);
    });

    const result = await orchestrator.executeWorkflow(plan, context);

    expect(result.success).toBe(true); // Handled by step fallback
    const actionRes = context.stepResults.step_action as { approved: boolean; reason: string };
    expect(actionRes.approved).toBe(false);
    expect(actionRes.reason).toContain('User denied authorization');
  });

  it('should execute Text Analysis workflow', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);
    const plan = createTextAnalysisWorkflow();
    const context = createTestContext('wf_text_diag');

    const result = await orchestrator.executeWorkflow(plan, context);

    expect(result.success).toBe(true);
    expect(context.variables.diagnosticReport).toBeDefined();
  });

  it('should recover using step retries when mock tool has transient failures', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('calculator', {
      failNTimes: 2, // Fails 2 times, 3rd time succeeds
      failureErrorCode: 'TRANSIENT_COMPUTE_BUSY',
    });

    const orchestrator = new WorkflowOrchestrator(executor);
    const builder = new WorkflowBuilder('wf_retry_test', 'Retry Test');
    builder.addToolStep('step_calc', 'Compute with retry', 'calculator', { expression: '10 + 20' }, {
      retryPolicy: { maxAttempts: 3, backoffMs: 15, backoffMultiplier: 1.5 },
    });
    builder.addSequentialTransitions();

    const context = createTestContext('wf_retry_run');
    const result = await orchestrator.executeWorkflow(builder.build(), context);

    expect(result.success).toBe(true);
    expect(context.attemptsPerStep.step_calc).toBe(3);
  });

  it('should execute Saga compensation rollback when workflow fails downstream', async () => {
    const executor = new MockToolExecutor();
    let compensationExecuted = false;

    executor.configureMock('comp_revert', {
      mockHandler: () => {
        compensationExecuted = true;
        return { reverted: true };
      },
    });

    // Make second step always fail
    executor.configureMock('summarize_text', {
      failNTimes: 10,
      failureErrorMessage: 'Fatal unrecoverable summarization failure',
    });

    const builder = new WorkflowBuilder('wf_saga_test', 'Saga Test');
    builder.addToolStep('step_calc_comp', 'Compute Result', 'calculator', {
      expression: '10 * 5',
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      compensationAction: {
        id: 'comp_cleanup',
        description: 'Revert computed state',
        toolName: 'comp_revert',
        parameters: { val: 50 },
        runOnFailureOnly: true,
      },
    });
    builder.addToolStep('step_summarize', 'Summarize Result', 'summarize_text', {
      text: 'content',
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
    });
    builder.addSequentialTransitions();

    const orchestrator = new WorkflowOrchestrator(executor);
    const context = createTestContext('wf_saga_run');
    const result = await orchestrator.executeWorkflow(builder.build(), context);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(WorkflowState.FAILED);
    expect(compensationExecuted).toBe(true);
  });

  it('should support conditional branching transitions', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    expect(orchestrator.getSafetyGate()).toBeDefined();
    expect(orchestrator.getToolExecutor()).toBeDefined();
    expect(orchestrator.getRecoveryEngine()).toBeDefined();

    const builder = new WorkflowBuilder('wf_branch', 'Branch Test');
    builder.addToolStep('step_calc', 'Compute', 'calculator', { expression: '10 + 20' }, {
      outputVariable: 'calcResult',
    });
    builder.addToolStep('step_high', 'High branch', 'summarize_text', { text: 'High value path' });
    builder.addToolStep('step_low', 'Low branch', 'summarize_text', { text: 'Low value path' });

    // Conditional transition: if calcResult.result > 25 -> step_high
    builder.addTransition('step_calc', 'step_high', {
      field: 'variables.calcResult.result',
      operator: 'greaterThan',
      value: 25,
    });
    builder.addTransition('step_calc', 'step_low', undefined, true); // default

    const context = createTestContext('wf_branch_ctx');
    const result = await orchestrator.executeWorkflow(builder.build(), context);

    expect(result.success).toBe(true);
    expect(result.executedSteps).toContain('step_high');
    expect(result.executedSteps).not.toContain('step_low');
  });

  it('should enforce maxExecutionSteps boundary', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    // Infinite loop A -> B -> A
    const builder = new WorkflowBuilder('wf_loop', 'Loop')
      .setMaxSteps(3)
      .addToolStep('step_a', 'Step A', 'calculator', { expression: '1+1' })
      .addToolStep('step_b', 'Step B', 'calculator', { expression: '2+2' })
      .addTransition('step_a', 'step_b')
      .addTransition('step_b', 'step_a');

    const context = createTestContext('wf_loop_ctx');
    const result = await orchestrator.executeWorkflow(builder.build(), context);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(WorkflowState.FAILED);
    expect(result.executedSteps.length).toBeLessThanOrEqual(3);
  });

  it('should pause and resume state machine during orchestrator execution', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    const builder = new WorkflowBuilder('wf_pause_test', 'Pause Test')
      .addObservationStep('obs_1', 'Observe Context')
      .addToolStep('tool_1', 'Compute Value', 'calculator', { expression: '5 * 5' })
      .addResponseStep('resp_1', 'Respond')
      .addSequentialTransitions();

    const context = createTestContext('wf_pause_ctx');

    // Pause on observation done
    orchestrator.on('stepFinished', async (data) => {
      if (data.stepId === 'obs_1') {
        await orchestrator.getStateMachine().pause();
        expect(orchestrator.getStateMachine().getState()).toBe(WorkflowState.PAUSED);
        await orchestrator.getStateMachine().resume();
        expect(orchestrator.getStateMachine().getState()).not.toBe(WorkflowState.PAUSED);
      }
    });

    const result = await orchestrator.executeWorkflow(builder.build(), context);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe(WorkflowState.COMPLETED);
  });

  it('should test input mapping and condition operators in workflow orchestrator', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    const builder = new WorkflowBuilder('wf_ops', 'Test condition operators');
    builder.addToolStep(
      'step_init',
      'Init step',
      'calculator',
      { expression: '2 * 3' },
      { outputVariable: 'val' }
    );
    builder.addToolStep(
      'step_mapped',
      'Mapped step',
      'calculator',
      { expression: '0' },
      {
        inputMapping: {
          expression: 'variables.val.expression',
        },
      }
    );
    builder.addToolStep('step_custom', 'Custom evaluator step', 'summarize_text', { text: 'custom' });
    builder.addToolStep('step_end', 'End', 'summarize_text', { text: 'done' });

    // Test contains condition
    builder.addTransition('step_init', 'step_mapped', {
      field: 'variables.val.expression',
      operator: 'contains',
      value: '*',
    });

    // Test customEvaluator condition
    builder.addTransition('step_mapped', 'step_custom', {
      operator: 'custom',
      customEvaluator: (ctx) => ctx.variables.val !== undefined,
    });

    // Test defined, equals, notEquals, lessThan
    builder.addTransition('step_custom', 'step_end', {
      field: 'variables.val.result',
      operator: 'lessThan',
      value: 100,
    });

    const context = createTestContext('wf_ops_ctx');
    const result = await orchestrator.executeWorkflow(builder.build(), context);

    expect(result.success).toBe(true);
    expect(result.executedSteps).toContain('step_mapped');
    expect(result.executedSteps).toContain('step_custom');
    expect(result.executedSteps).toContain('step_end');
  });

  it('should test equals, notEquals, and defined condition operators', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    const builder = new WorkflowBuilder('wf_conds', 'Condition ops');
    builder.addToolStep('s1', 'Step 1', 'calculator', { expression: '7 + 3' }, { outputVariable: 'out' });
    builder.addToolStep('s2', 'Step 2', 'summarize_text', { text: 't2' });
    builder.addToolStep('s3', 'Step 3', 'summarize_text', { text: 't3' });
    builder.addToolStep('s4', 'Step 4', 'summarize_text', { text: 't4' });

    builder.addTransition('s1', 's2', {
      field: 'variables.out.result',
      operator: 'equals',
      value: 10,
    });
    builder.addTransition('s2', 's3', {
      field: 'variables.out.result',
      operator: 'notEquals',
      value: 999,
    });
    builder.addTransition('s3', 's4', {
      field: 'variables.out',
      operator: 'defined',
    });

    const ctx = createTestContext('wf_conds_ctx');
    const res = await orchestrator.executeWorkflow(builder.build(), ctx);
    expect(res.success).toBe(true);
    expect(res.executedSteps).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('should throw error when step is missing in definition', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);
    const def = new WorkflowBuilder('wf_missing', 'Missing Step')
      .addToolStep('s1', 'S1', 'calculator', { expression: '1+1' })
      .addTransition('s1', 'ghost_step')
      .build();

    const ctx = createTestContext('wf_missing_ctx');
    const res = await orchestrator.executeWorkflow(def, ctx);
    expect(res.success).toBe(false);
    expect(res.error?.message).toContain("Step 'ghost_step' was not found");
  });

  it('should test tool fallback DEFAULT_OUTPUT with outputVariable and stepResults mapping', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('calculator', {
      failNTimes: 5,
      failureErrorMessage: 'Persistent computation engine down',
    });

    const orchestrator = new WorkflowOrchestrator(executor);
    const builder = new WorkflowBuilder('wf_fallback_def', 'Fallback Def');

    builder.addToolStep(
      's_failing',
      'Failing calc',
      'calculator',
      { expression: 'test' },
      {
        outputVariable: 'cachedDocs',
        fallbackAction: {
          type: 'DEFAULT_OUTPUT',
          defaultOutput: { fallbackCached: true, query: 'test' },
        },
      }
    );

    builder.addToolStep(
      's_consumer',
      'Consume fallback',
      'summarize_text',
      { text: 'default' },
      {
        inputMapping: {
          text: 'stepResults.s_failing.query',
        },
      }
    );

    builder.addTransition('s_failing', 's_consumer', {
      field: 'stepResults.s_failing.fallbackCached',
      operator: 'equals',
      value: true,
    });

    const ctx = createTestContext('wf_fallback_ctx');
    const res = await orchestrator.executeWorkflow(builder.build(), ctx);

    expect(res.success).toBe(true);
    expect(ctx.variables.cachedDocs).toEqual({ fallbackCached: true, query: 'test' });
    expect(res.executedSteps).toContain('s_consumer');
  });

  it('should exercise fallback branches in predefined workflows and condition defaults', async () => {
    const executor = new MockToolExecutor();
    const orchestrator = new WorkflowOrchestrator(executor);

    // 1. Calculation & summary workflow fallback
    const pdfDef = createPdfSummarizeWorkflow();
    const pdfCtx = createTestContext('wf_pdf_fallback');
    pdfCtx.variables.calcResult = {};
    const pdfRes = await orchestrator.executeWorkflow(pdfDef, pdfCtx);
    expect(pdfRes.success).toBe(true);

    // 2. Text Analysis workflow with empty observation input
    const diagDef = createCodeErrorDiagnosisWorkflow();
    const diagCtx = createTestContext('wf_diag_fallback');
    diagCtx.stepResults.obs_input = {};
    const diagRes = await orchestrator.executeWorkflow(diagDef, diagCtx);
    expect(diagRes.success).toBe(true);

    // 3. Condition with unknown operator defaults to true
    const bld = new WorkflowBuilder('wf_def_op', 'Default op');
    bld.addToolStep('s1', 'S1', 'calculator', { expression: '1' });
    bld.addToolStep('s2', 'S2', 'calculator', { expression: '2' });
    bld.addTransition('s1', 's2', {
      field: 'variables.none',
      operator: 'unknown_op' as never,
    });
    const opCtx = createTestContext('wf_def_op_ctx');
    const opRes = await orchestrator.executeWorkflow(bld.build(), opCtx);
    expect(opRes.success).toBe(true);
  });
});
