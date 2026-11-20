/**
 * Checkpoint, Resume & Idempotency Test Suite
 * Validates Week 3 Milestone D15-16:
 * - Checkpoint persistence and restoration
 * - Failed-step recovery without re-running completed steps
 * - Idempotency keys preventing duplicate tool executions
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import { CheckpointManager } from '../src/checkpoint/CheckpointManager.js';
import { IdempotencyManager } from '../src/safety/IdempotencyManager.js';
import { AuditTrail } from '../src/audit/AuditTrail.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import {
  WorkflowContext,
  WorkflowState,
  RiskLevel,
  StepType,
  WorkflowPlan,
} from '../src/types/index.js';

function createMockContext(workflowId = 'wf_test_ckpt'): WorkflowContext {
  return {
    workflowId,
    name: 'Checkpoint Test Workflow',
    userRequest: {
      requestId: `req_${Date.now()}`,
      sessionId: 'sess_test',
      rawVoiceInput: 'Run multi-step analysis',
      intent: 'multi_step_analysis',
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'VS Code - Academia AI Co-Pilot',
      windowTitle: 'Test Workspace',
      visibleContent: 'Testing buffer contents',
    },
    stepResults: {},
    variables: { initialData: 100 },
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('Milestone D15-16: Checkpoint, Resume & Idempotency Suite', () => {
  let toolExecutor: MockToolExecutor;
  let safetyGate: SafetyGate;
  let checkpointManager: CheckpointManager;
  let idempotencyManager: IdempotencyManager;
  let auditTrail: AuditTrail;
  let orchestrator: WorkflowOrchestrator;

  beforeEach(() => {
    toolExecutor = new MockToolExecutor();
    safetyGate = new SafetyGate();
    checkpointManager = new CheckpointManager();
    idempotencyManager = new IdempotencyManager();
    auditTrail = new AuditTrail();

    orchestrator = new WorkflowOrchestrator(
      toolExecutor,
      safetyGate,
      undefined,
      undefined,
      checkpointManager,
      idempotencyManager,
      auditTrail
    );
  });

  describe('1. CheckpointManager State Persistence & Isolation', () => {
    it('should save and retrieve a valid workflow checkpoint', async () => {
      const plan = new WorkflowBuilder('wf_snap', 'Snapshot Plan')
        .addStep({ id: 's1', name: 'Step 1', type: StepType.REASONING, description: 'Reasoning' })
        .addStep({ id: 's2', name: 'Step 2', type: StepType.RESPONSE, description: 'Response' })
        .addSequentialTransitions()
        .build();

      const context = createMockContext('wf_snap');
      context.variables.count = 42;
      context.stepResults.s1 = { completed: true };

      const ckpt = await checkpointManager.saveCheckpoint(
        plan,
        context,
        WorkflowState.PLANNING,
        's1',
        ['s1']
      );

      expect(ckpt.checkpointId).toBeDefined();
      expect(ckpt.workflowId).toBe('wf_snap');
      expect(ckpt.stepId).toBe('s1');
      expect(ckpt.completedStepIds).toEqual(['s1']);
      expect(ckpt.variables.count).toBe(42);

      const retrieved = await checkpointManager.getCheckpoint(ckpt.checkpointId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.checkpointId).toBe(ckpt.checkpointId);
      expect(retrieved?.completedStepIds).toEqual(['s1']);
    });

    it('should guarantee snapshot isolation (mutations after save do not alter checkpoint)', async () => {
      const plan = new WorkflowBuilder('wf_iso', 'Isolation Plan')
        .addStep({ id: 's1', name: 'Step 1', type: StepType.REASONING, description: 'R' })
        .build();

      const context = createMockContext('wf_iso');
      context.variables.userScore = 90;

      const ckpt = await checkpointManager.saveCheckpoint(
        plan,
        context,
        WorkflowState.REASONING,
        's1',
        ['s1']
      );

      // Mutate original context
      context.variables.userScore = 999;
      context.variables.hacked = true;

      const retrieved = await checkpointManager.getCheckpoint(ckpt.checkpointId);
      expect(retrieved?.variables.userScore).toBe(90);
      expect(retrieved?.variables.hacked).toBeUndefined();
    });

    it('should list and clear checkpoints by workflow ID', async () => {
      const plan = new WorkflowBuilder('wf_list', 'List Plan')
        .addStep({ id: 's1', name: 'S1', type: StepType.REASONING, description: 'R' })
        .build();

      const ctxA = createMockContext('wf_A');
      const ctxB = createMockContext('wf_B');

      await checkpointManager.saveCheckpoint(plan, ctxA, WorkflowState.REASONING, 's1', ['s1']);
      await checkpointManager.saveCheckpoint(plan, ctxB, WorkflowState.REASONING, 's1', ['s1']);

      expect((await checkpointManager.listCheckpoints()).length).toBe(2);
      expect((await checkpointManager.listCheckpoints('wf_A')).length).toBe(1);

      await checkpointManager.clearCheckpoints('wf_A');
      expect((await checkpointManager.listCheckpoints('wf_A')).length).toBe(0);
      expect((await checkpointManager.listCheckpoints('wf_B')).length).toBe(1);
    });
  });

  describe('2. Checkpoint & Resume: Completed Steps Are NEVER Re-executed', () => {
    it('should resume from checkpoint and execute ONLY the remaining steps', async () => {
      const calcSpy = vi.spyOn(toolExecutor, 'execute');

      const plan: WorkflowPlan = {
        id: 'wf_resume_demo',
        name: 'Resume Demo Plan',
        version: '1.0.0',
        description: '3-step workflow verifying no duplicate execution of step 1 and 2',
        initialStepId: 'step_1',
        steps: [
          {
            id: 'step_1',
            name: 'Compute Part 1',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '10 + 20' },
            riskLevel: RiskLevel.A_INFORMATIONAL,
            description: 'First calculation',
            outputVariable: 'res1',
          },
          {
            id: 'step_2',
            name: 'Compute Part 2',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '30 + 40' },
            riskLevel: RiskLevel.A_INFORMATIONAL,
            description: 'Second calculation',
            outputVariable: 'res2',
          },
          {
            id: 'step_3',
            name: 'Compute Final',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '70 + 30' },
            riskLevel: RiskLevel.A_INFORMATIONAL,
            description: 'Final calculation',
            outputVariable: 'finalRes',
          },
        ],
        transitions: [
          { fromStepId: 'step_1', toStepId: 'step_2' },
          { fromStepId: 'step_2', toStepId: 'step_3' },
        ],
      };

      const context = createMockContext('wf_resume_demo');

      // 1. Execute initial workflow (stops or snapshots after step_2)
      // We manually create a checkpoint as if step_1 and step_2 succeeded and execution paused
      const step1Result = { expression: '10 + 20', result: 30 };
      const step2Result = { expression: '30 + 40', result: 70 };

      context.stepResults['step_1'] = step1Result;
      context.stepResults['step_2'] = step2Result;
      context.variables['res1'] = step1Result;
      context.variables['res2'] = step2Result;

      const checkpoint = await checkpointManager.saveCheckpoint(
        plan,
        context,
        WorkflowState.EXECUTING_TOOL,
        'step_2',
        ['step_1', 'step_2']
      );

      calcSpy.mockClear();

      // 2. Resume workflow from checkpoint
      const result = await orchestrator.resumeWorkflow(checkpoint.checkpointId);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(WorkflowState.COMPLETED);

      // Verify executed steps contain all 3
      expect(result.executedSteps).toEqual(['step_1', 'step_2', 'step_3']);

      // CRITICAL VERIFICATION:
      // The tool executor should have executed ONLY step_3 (exactly 1 call)!
      // Step 1 and Step 2 were already completed in the checkpoint and MUST NOT be re-executed!
      expect(calcSpy).toHaveBeenCalledTimes(1);
      expect(calcSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stepId: 'step_3',
          parameters: { expression: '70 + 30' },
        })
      );

      // Output should contain results from step 1, 2, and 3
      expect(result.outputs.res1).toEqual(step1Result);
      expect(result.outputs.res2).toEqual(step2Result);
      expect((result.outputs.finalRes as { result: number }).result).toBe(100);
    });
  });

  describe('3. Failed-Step Recovery', () => {
    it('should save a failure checkpoint when a step fails and allow recovery from the failed step', async () => {
      // Step 1 succeeds, Step 2 fails initially
      toolExecutor.configureMock('calculator', {
        failNTimes: 1,
        failureErrorCode: 'TRANSIENT_SYSTEM_BUSY',
        failureErrorMessage: 'Service unavailable',
      });

      const plan: WorkflowPlan = {
        id: 'wf_fail_recovery',
        name: 'Failure Recovery Workflow',
        version: '1.0.0',
        description: 'Recovers from failed step without re-running step 1',
        initialStepId: 'step_init',
        steps: [
          {
            id: 'step_init',
            name: 'Initial Reasoning',
            type: StepType.REASONING,
            description: 'Step 1: Setup data',
          },
          {
            id: 'step_calc_2',
            name: 'Second Calculation',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '200 * 3' },
            description: 'Step 2 (Fails first time)',
            outputVariable: 'calc2',
          },
        ],
        transitions: [{ fromStepId: 'step_init', toStepId: 'step_calc_2' }],
      };

      const context = createMockContext('wf_fail_recovery');
      const spy = vi.spyOn(toolExecutor, 'execute');

      // Run initially -> fails at step_calc_2
      const firstRun = await orchestrator.executeWorkflow(plan, context);
      expect(firstRun.success).toBe(false);
      expect(firstRun.error?.stepId).toBe('step_calc_2');

      // Confirm failure checkpoint was automatically created
      const checkpoints = await checkpointManager.listCheckpoints('wf_fail_recovery');
      const failCkpt = checkpoints.find((c) => c.status === 'FAILED');
      expect(failCkpt).toBeDefined();
      expect(failCkpt?.failedStepId).toBe('step_calc_2');
      expect(failCkpt?.completedStepIds).toContain('step_init');

      spy.mockClear();

      // Clear the mock error to simulate backend recovery / fix
      toolExecutor.configureMock('calculator', { failNTimes: 0 });

      // Resume from the failure checkpoint
      const resumedRun = await orchestrator.resumeWorkflow(failCkpt!.checkpointId);

      expect(resumedRun.success).toBe(true);
      expect(resumedRun.finalState).toBe(WorkflowState.COMPLETED);

      // CRITICAL INVARIANT: Step 1 was NOT re-run; ONLY step 2 ran
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          stepId: 'step_calc_2',
        })
      );
      expect(resumedRun.outputs.calc2).toBeDefined();
    });
  });

  describe('4. Idempotency Keys: Prevent Duplicate Execution', () => {
    it('should compute deterministic hashes regardless of parameter key ordering', () => {
      const hash1 = idempotencyManager.hashParameters({ b: 2, a: 1, c: { y: 2, x: 1 } });
      const hash2 = idempotencyManager.hashParameters({ a: 1, c: { y: 2, x: 1 }, b: 2 });
      expect(hash1).toBe(hash2);
    });

    it('should return cached result and NEVER execute underlying tool on duplicate key', async () => {
      let underlyingExecutionCount = 0;
      const mockOperation = async () => {
        underlyingExecutionCount++;
        return { data: 'processed_payload_result' };
      };

      const key = 'idem_key_12345';
      const params = { query: 'summarize report', maxTokens: 100 };

      // Call 1: Runs tool
      const call1 = await idempotencyManager.executeWithIdempotency(
        key,
        'summarize_text',
        params,
        mockOperation
      );
      expect(call1.cached).toBe(false);
      expect(call1.result).toEqual({ data: 'processed_payload_result' });
      expect(underlyingExecutionCount).toBe(1);

      // Call 2: Returns cached, tool NOT executed
      const call2 = await idempotencyManager.executeWithIdempotency(
        key,
        'summarize_text',
        params,
        mockOperation
      );
      expect(call2.cached).toBe(true);
      expect(call2.result).toEqual({ data: 'processed_payload_result' });
      expect(underlyingExecutionCount).toBe(1); // STILL 1!

      // Call 3: Duplicate again
      const call3 = await idempotencyManager.executeWithIdempotency(
        key,
        'summarize_text',
        params,
        mockOperation
      );
      expect(call3.cached).toBe(true);
      expect(underlyingExecutionCount).toBe(1); // STILL 1!

      const record = idempotencyManager.get(key);
      expect(record?.executionCount).toBe(3);
    });

    it('should enforce idempotency in WorkflowOrchestrator across re-invocations', async () => {
      const executeSpy = vi.spyOn(toolExecutor, 'execute');

      const plan = new WorkflowBuilder('wf_idempotent_test', 'Idempotency Test')
        .addToolStep(
          'step_calc_idempotent',
          'Calculate Tax',
          'calculator',
          { expression: '250 * 0.18' },
          {
            isIdempotent: true,
            metadata: { idempotencyKey: 'custom_fixed_tax_key' },
          }
        )
        .build();

      const context1 = createMockContext('wf_idempotent_test');
      const run1 = await orchestrator.executeWorkflow(plan, context1);
      expect(run1.success).toBe(true);
      expect(executeSpy).toHaveBeenCalledTimes(1);

      // Execute again with new context but identical idempotency key
      const context2 = createMockContext('wf_idempotent_test');
      const run2 = await orchestrator.executeWorkflow(plan, context2);
      expect(run2.success).toBe(true);

      // INVARIANT: Tool handler was called ONLY ONCE across both complete workflow runs!
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
