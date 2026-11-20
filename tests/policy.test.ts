/**
 * Policy & Safety Acceptance Test Suite (Week 2)
 * Rigorously verifies:
 * 1. Plan validation: Missing dependencies and cycles are rejected with clear errors
 * 2. Allow-listed tool registry: Only allow-listed harmless tools run; argument validation and permission scopes enforced
 * 3. Approval gate: Approve, reject, and expiry logic; rejected and expired actions NEVER execute
 * 4. Safe executor: Timeouts, bounded retries for idempotent calls only, and cancellation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  WorkflowPlan,
  WorkflowStep,
  StepType,
  WorkflowContext,
  RiskLevel,
  WorkflowState,
} from '../src/types/index.js';
import { PlanValidator, PlanValidationError } from '../src/validation/PlanValidator.js';
import {
  ToolRegistry,
  ToolNotAllowlistedError,
  ToolParameterValidationError,
  PermissionScopeError,
  DangerousToolForbiddenError,
} from '../src/tools/ToolRegistry.js';
import {
  ApprovalManager,
  ApprovalExpiredError,
  ActionExecutionBlockedError,
} from '../src/safety/ApprovalManager.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafeExecutor } from '../src/scheduler/SafeExecutor.js';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';

function createMockContext(workflowId = 'wf_policy_test'): WorkflowContext {
  return {
    workflowId,
    name: 'Policy Test Workflow',
    userRequest: {
      requestId: 'req_test',
      sessionId: 'sess_test',
      timestamp: Date.now(),
    },
    appContext: {},
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('Week 2 Safety & Policy Verification Suite', () => {
  // =========================================================================
  // 1. Plan Validator: Dependencies and Cycles Validation
  // =========================================================================
  describe('Plan Validator — Dependencies and Cycle Validation', () => {
    it('should reject a plan when initialStepId does not exist in steps', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_missing_initial',
        name: 'Invalid Initial Step',
        version: '1.0.0',
        description: 'Testing missing initial step',
        initialStepId: 'step_non_existent',
        steps: [
          {
            id: 'step_real',
            name: 'Real Step',
            type: StepType.REASONING,
            description: 'A valid step',
          },
        ],
        transitions: [],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_INITIAL_STEP')).toBe(true);
      expect(result.errors[0].message).toContain("Initial step 'step_non_existent' does not exist");

      expect(() => validator.validateOrThrow(plan)).toThrow(PlanValidationError);
    });

    it('should reject a plan with missing step dependencies with a clear error', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_missing_dep',
        name: 'Missing Dependency Plan',
        version: '1.0.0',
        description: 'Step depends on phantom step',
        initialStepId: 'step_1',
        steps: [
          {
            id: 'step_1',
            name: 'Step 1',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            description: 'Compute total',
            dependencies: ['step_does_not_exist'],
          },
        ],
        transitions: [],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      const depError = result.errors.find((e) => e.code === 'MISSING_STEP_DEPENDENCY');
      expect(depError).toBeDefined();
      expect(depError?.message).toContain("Step 'step_1' depends on missing step 'step_does_not_exist'");
      expect(depError?.stepId).toBe('step_1');
    });

    it('should reject self-dependency cycle (step depending on itself)', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_self_cycle',
        name: 'Self Cycle Plan',
        version: '1.0.0',
        description: 'Self-referencing step',
        initialStepId: 'step_loop',
        steps: [
          {
            id: 'step_loop',
            name: 'Looping Step',
            type: StepType.REASONING,
            description: 'Self loop',
            dependencies: ['step_loop'],
          },
        ],
        transitions: [],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'DEPENDENCY_CYCLE_DETECTED')).toBe(true);
      expect(result.errors[0].message).toContain('cannot depend on itself');
    });

    it('should detect and reject direct 2-step dependency cycle (A -> B -> A)', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_direct_cycle',
        name: 'Direct Cycle Plan',
        version: '1.0.0',
        description: 'A depends on B and B depends on A',
        initialStepId: 'step_a',
        steps: [
          {
            id: 'step_a',
            name: 'Step A',
            type: StepType.REASONING,
            description: 'Depends on B',
            dependencies: ['step_b'],
          },
          {
            id: 'step_b',
            name: 'Step B',
            type: StepType.REASONING,
            description: 'Depends on A',
            dependencies: ['step_a'],
          },
        ],
        transitions: [],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      const cycleError = result.errors.find((e) => e.code === 'DEPENDENCY_CYCLE_DETECTED');
      expect(cycleError).toBeDefined();
      expect(cycleError?.message).toContain('Dependency cycle detected');
      expect(cycleError?.cycle).toBeDefined();
    });

    it('should detect and reject multi-step indirect dependency cycle (A -> B -> C -> A)', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_indirect_cycle',
        name: 'Indirect Cycle Plan',
        version: '1.0.0',
        description: 'Triangular cycle',
        initialStepId: 's_a',
        steps: [
          { id: 's_a', name: 'A', type: StepType.REASONING, description: 'A', dependencies: ['s_b'] },
          { id: 's_b', name: 'B', type: StepType.REASONING, description: 'B', dependencies: ['s_c'] },
          { id: 's_c', name: 'C', type: StepType.REASONING, description: 'C', dependencies: ['s_a'] },
        ],
        transitions: [],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      const cycleError = result.errors.find((e) => e.code === 'DEPENDENCY_CYCLE_DETECTED');
      expect(cycleError).toBeDefined();
      expect(cycleError?.message).toContain('Dependency cycle detected');
    });

    it('should reject transitions referencing missing steps', () => {
      const validator = new PlanValidator();
      const plan: WorkflowPlan = {
        id: 'plan_bad_trans',
        name: 'Bad Transition Plan',
        version: '1.0.0',
        description: 'Transition to missing step',
        initialStepId: 's1',
        steps: [{ id: 's1', name: 'S1', type: StepType.REASONING, description: 'First' }],
        transitions: [
          { fromStepId: 's1', toStepId: 's_phantom' },
          { fromStepId: 's_ghost', toStepId: 's1' },
        ],
      };

      const result = validator.validate(plan);
      expect(result.isValid).toBe(false);
      const transErrors = result.errors.filter((e) => e.code === 'MISSING_TRANSITION_STEP');
      expect(transErrors.length).toBe(2);
      expect(transErrors[0].message).toContain("Transition references non-existent toStepId 's_phantom'");
      expect(transErrors[1].message).toContain("Transition references non-existent fromStepId 's_ghost'");
    });

    it('should reject duplicate step IDs and empty workflows', () => {
      const validator = new PlanValidator();
      const emptyResult = validator.validate({
        id: 'empty',
        name: 'Empty',
        version: '1.0.0',
        description: '',
        initialStepId: '',
        steps: [],
        transitions: [],
      });
      expect(emptyResult.isValid).toBe(false);
      expect(emptyResult.errors.some((e) => e.code === 'EMPTY_WORKFLOW')).toBe(true);

      const dupResult = validator.validate({
        id: 'dup',
        name: 'Dup',
        version: '1.0.0',
        description: '',
        initialStepId: 's1',
        steps: [
          { id: 's1', name: 'Step 1', type: StepType.REASONING, description: 'A' },
          { id: 's1', name: 'Step 1 Duplicate', type: StepType.REASONING, description: 'B' },
        ],
        transitions: [],
      });
      expect(dupResult.isValid).toBe(false);
      expect(dupResult.errors.some((e) => e.code === 'DUPLICATE_STEP_ID')).toBe(true);
    });

    it('should validate tool registrations and reject unlisted tools referenced in steps', () => {
      const registry = new ToolRegistry(true);
      const validator = new PlanValidator(registry);

      const planWithUnlistedTool: WorkflowPlan = {
        id: 'plan_unlisted_tool',
        name: 'Unlisted Tool Plan',
        version: '1.0.0',
        description: 'References unlisted tool',
        initialStepId: 's1',
        steps: [
          {
            id: 's1',
            name: 'Run Unregistered',
            type: StepType.TOOL_EXECUTION,
            toolName: 'unknown_tool',
            description: 'Calls unlisted tool',
          },
        ],
        transitions: [],
      };

      const result = validator.validate(planWithUnlistedTool);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'UNREGISTERED_TOOL')).toBe(true);
    });

    it('should successfully pass a valid DAG plan with dependencies and allow-listed tools', () => {
      const registry = new ToolRegistry(true);
      const validator = new PlanValidator(registry);

      const validPlan: WorkflowPlan = {
        id: 'plan_valid',
        name: 'Valid Workflow',
        version: '1.0.0',
        description: 'Valid DAG without cycles',
        initialStepId: 'step_calc',
        steps: [
          {
            id: 'step_calc',
            name: 'Compute',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '10 * 5' },
            description: 'Calculation',
          },
          {
            id: 'step_summary',
            name: 'Summarize',
            type: StepType.TOOL_EXECUTION,
            toolName: 'summarize_text',
            toolParameters: { text: 'Valid analysis content to summarize' },
            dependencies: ['step_calc'],
            description: 'Summary',
          },
        ],
        transitions: [{ fromStepId: 'step_calc', toStepId: 'step_summary' }],
      };

      const result = validator.validate(validPlan);
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(() => validator.validateOrThrow(validPlan)).not.toThrow();
    });
  });

  // =========================================================================
  // 2. Allow-listed Tool Registry, Argument Validation & Permission Scopes
  // =========================================================================
  describe('Tool Registry — Allow-list, Schema Validation, Permission Scopes', () => {
    it('should only permit harmless tools by default in allow-list', () => {
      const registry = new ToolRegistry(true);
      expect(registry.isAllowlisted('calculator')).toBe(true);
      expect(registry.isAllowlisted('summarize_text')).toBe(true);
      expect(registry.isAllowlisted('unlisted_tool')).toBe(false);
      expect(registry.getAllowlist().sort()).toEqual(['calculator', 'summarize_text'].sort());
    });

    it('should strictly forbid dangerous tools (unrestricted computer control and external sending)', () => {
      const registry = new ToolRegistry(true);

      // Attempt registering shell execution tools
      expect(() =>
        registry.register({
          name: 'bash_shell_exec',
          description: 'Dangerous shell',
          purpose: 'Forbidden',
          parameters: { type: 'object', properties: {} },
          riskLevel: RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
          failureBehavior: 'ABORT',
        })
      ).toThrow(DangerousToolForbiddenError);

      // Attempt registering terminal execution
      expect(() =>
        registry.register({
          name: 'run_terminal_command',
          description: 'Terminal command',
          purpose: 'Forbidden',
          parameters: { type: 'object', properties: {} },
          riskLevel: RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
          failureBehavior: 'ABORT',
        })
      ).toThrow(DangerousToolForbiddenError);

      // Attempt registering external email sender
      expect(() =>
        registry.register({
          name: 'send_email_smtp',
          description: 'External sender',
          purpose: 'Forbidden',
          parameters: { type: 'object', properties: {} },
          riskLevel: RiskLevel.C_SENSITIVE,
          failureBehavior: 'ABORT',
        })
      ).toThrow(DangerousToolForbiddenError);
    });

    it('should reject unlisted tools with ToolNotAllowlistedError', () => {
      const registry = new ToolRegistry(true);
      expect(() => registry.assertAllowlisted('not_allowed')).toThrow(ToolNotAllowlistedError);
    });

    it('should validate parameters strictly against schema: missing required, wrong type, invalid enum', () => {
      const registry = new ToolRegistry(true);

      // Missing required parameter
      expect(() => registry.validateParameters('calculator', {})).toThrow(
        ToolParameterValidationError
      );

      // Wrong type
      expect(() =>
        registry.validateParameters('summarize_text', { text: 12345 as unknown as string })
      ).toThrow(ToolParameterValidationError);

      // Custom tool with enum validation
      registry.register({
        name: 'custom_format',
        description: 'Formatting',
        purpose: 'Testing',
        parameters: {
          type: 'object',
          properties: {
            format: { type: 'string', description: 'format', enum: ['json', 'csv', 'yaml'] },
          },
          required: ['format'],
        },
        riskLevel: RiskLevel.A_INFORMATIONAL,
        failureBehavior: 'ABORT',
      });

      expect(() => registry.validateParameters('custom_format', { format: 'invalid_xml' })).toThrow(
        ToolParameterValidationError
      );
      expect(() => registry.validateParameters('custom_format', { format: 'json' })).not.toThrow();
    });

    it('should enforce permission scopes and deny execution when caller lacks required scopes', () => {
      const registry = new ToolRegistry(true);

      // Calculator requires ['math:calculate', 'tools:read']
      // 1. Caller with empty scopes -> Denied
      expect(() => registry.checkPermissionScopes('calculator', [])).toThrow(PermissionScopeError);

      // 2. Caller with unrelated scope -> Denied
      expect(() => registry.checkPermissionScopes('calculator', ['text:summarize'])).toThrow(
        PermissionScopeError
      );

      // 3. Caller with only one of required scopes -> Denied
      expect(() => registry.checkPermissionScopes('calculator', ['math:calculate'])).toThrow(
        PermissionScopeError
      );

      // 4. Caller with all required scopes -> Granted
      expect(
        registry.checkPermissionScopes('calculator', ['math:calculate', 'tools:read'])
      ).toBe(true);

      // 5. Caller with wildcard scope '*' -> Granted
      expect(registry.checkPermissionScopes('calculator', ['*'])).toBe(true);

      // 6. Caller with prefix wildcard 'tools:*' and 'math:*' -> Granted
      expect(
        registry.checkPermissionScopes('calculator', ['tools:*', 'math:*'])
      ).toBe(true);
    });
  });

  // =========================================================================
  // 3. Approval Gate: Approve, Reject, Expiry & Execution Invariant
  // =========================================================================
  describe('Approval Gate — Approve, Reject, Expiry and Non-execution Invariants', () => {
    it('should create approval requests with configurable TTL and initial PENDING state', () => {
      const manager = new ApprovalManager({ defaultTtlMs: 60000 });
      const req = manager.createRequest({
        workflowId: 'wf_appr',
        stepId: 'step_edit',
        toolName: 'file_edit',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { file: 'doc.txt' },
      });

      expect(req.status).toBe('PENDING');
      expect(req.ttlMs).toBe(60000);
      expect(req.expiresAt).toBeGreaterThan(Date.now());
      expect(manager.getPendingApprovals().length).toBe(1);
    });

    it('should transition status to APPROVED when approved by user', () => {
      const manager = new ApprovalManager();
      const req = manager.createRequest({
        workflowId: 'wf_appr',
        stepId: 'step_edit',
        toolName: 'file_edit',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { file: 'doc.txt' },
      });

      const decision = manager.approve(req.approvalId, { reason: 'Confirmed by engineer' });
      expect(decision.approved).toBe(true);
      expect(decision.reason).toBe('Confirmed by engineer');
      expect(manager.getStatus(req.approvalId)).toBe('APPROVED');
      expect(manager.canExecute(req.approvalId)).toBe(true);
      expect(() => manager.assertCanExecute(req.approvalId)).not.toThrow();
    });

    it('should transition status to REJECTED when rejected by user', () => {
      const manager = new ApprovalManager();
      const req = manager.createRequest({
        workflowId: 'wf_appr',
        stepId: 'step_del',
        toolName: 'file_delete',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { file: 'doc.txt' },
      });

      const decision = manager.reject(req.approvalId, 'Do not touch production files');
      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe('Do not touch production files');
      expect(manager.getStatus(req.approvalId)).toBe('REJECTED');
      expect(manager.canExecute(req.approvalId)).toBe(false);
    });

    it('should transition to EXPIRED when TTL lapses, and reject approval attempts on expired requests', async () => {
      const manager = new ApprovalManager();
      // Create request with very short TTL of 20ms
      const req = manager.createRequest({
        workflowId: 'wf_appr',
        stepId: 'step_expire',
        toolName: 'file_modify',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { file: 'test.cfg' },
        ttlMs: 20,
      });

      expect(manager.isExpired(req.approvalId)).toBe(false);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 35));

      expect(manager.isExpired(req.approvalId)).toBe(true);
      expect(manager.getStatus(req.approvalId)).toBe('EXPIRED');

      // Attempting to approve expired request must throw ApprovalExpiredError
      expect(() => manager.approve(req.approvalId)).toThrow(ApprovalExpiredError);
      expect(manager.canExecute(req.approvalId)).toBe(false);
    });

    it('INVARIANT: a REJECTED action NEVER executes (tool mock handler called 0 times)', async () => {
      const registry = new ToolRegistry(true);
      const safetyGate = new SafetyGate();
      const safeExecutor = new SafeExecutor(registry, safetyGate);

      const toolSpy = vi.fn((params) => ({ computed: true, input: params }));
      safeExecutor.getMockExecutor().configureMock('calculator', {
        mockHandler: toolSpy,
      });

      // 1. Create approval request
      const approvalReq = safetyGate.getApprovalManager().createRequest({
        workflowId: 'wf_reject_test',
        stepId: 'step_math',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '99 * 99' },
      });

      // 2. Reject the action
      safetyGate.reject(approvalReq.approvalId, 'Security policy: operation denied');

      // 3. Attempt execution with the rejected approval token
      const res = await safeExecutor.executeTool({
        requestId: 'r_rejected',
        workflowId: 'wf_reject_test',
        stepId: 'step_math',
        toolName: 'calculator',
        parameters: { expression: '99 * 99' },
        riskLevel: RiskLevel.C_SENSITIVE,
        approvalToken: approvalReq.approvalId,
      });

      // Verification: Action was blocked
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ACTION_APPROVAL_BLOCKED');
      expect(res.error?.message).toContain('Rejected actions never execute');

      // Critical Guarantee: Tool handler was invoked EXACTLY ZERO times
      expect(toolSpy).toHaveBeenCalledTimes(0);
    });

    it('INVARIANT: an EXPIRED action NEVER executes (tool mock handler called 0 times)', async () => {
      const registry = new ToolRegistry(true);
      const safetyGate = new SafetyGate();
      const safeExecutor = new SafeExecutor(registry, safetyGate);

      const toolSpy = vi.fn((params) => ({ summarized: true, input: params }));
      safeExecutor.getMockExecutor().configureMock('summarize_text', {
        mockHandler: toolSpy,
      });

      // 1. Create approval with 15ms TTL
      const approvalReq = safetyGate.getApprovalManager().createRequest({
        workflowId: 'wf_expire_test',
        stepId: 'step_summ',
        toolName: 'summarize_text',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { text: 'Time sensitive summary' },
        ttlMs: 15,
      });

      // 2. Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 3. Attempt execution with the expired approval token
      const res = await safeExecutor.executeTool({
        requestId: 'r_expired',
        workflowId: 'wf_expire_test',
        stepId: 'step_summ',
        toolName: 'summarize_text',
        parameters: { text: 'Time sensitive summary' },
        riskLevel: RiskLevel.C_SENSITIVE,
        approvalToken: approvalReq.approvalId,
      });

      // Verification: Action was blocked due to expiry
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ACTION_APPROVAL_BLOCKED');
      expect(res.error?.message).toContain('Expired actions never execute');

      // Critical Guarantee: Tool handler was invoked EXACTLY ZERO times
      expect(toolSpy).toHaveBeenCalledTimes(0);
    });

    it('should enforce double confirmation for high-risk actions when configured', () => {
      const manager = new ApprovalManager({ enforceDoubleConfirmation: true });
      const req = manager.createRequest({
        workflowId: 'wf_d',
        stepId: 'step_d',
        toolName: 'system_reboot',
        riskLevel: RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
        parameters: {},
        requiresDoubleConfirmation: true,
      });

      // 1st approval -> Remains pending second confirmation
      const firstDecision = manager.approve(req.approvalId, { reason: '1st confirm' });
      expect(firstDecision.approved).toBe(false);
      expect(manager.canExecute(req.approvalId)).toBe(false);
      expect(manager.getStatus(req.approvalId)).toBe('PENDING');

      // 2nd approval -> Fully approved
      const secondDecision = manager.approve(req.approvalId, { reason: '2nd confirm' });
      expect(secondDecision.approved).toBe(true);
      expect(manager.canExecute(req.approvalId)).toBe(true);
      expect(manager.getStatus(req.approvalId)).toBe('APPROVED');
    });
  });

  // =========================================================================
  // 4. Safe Executor: Timeouts, Bounded Retries for Idempotent Calls Only, Cancellation
  // =========================================================================
  describe('Safe Executor — Timeouts, Bounded Idempotent Retries, Cancellation', () => {
    it('should enforce execution timeouts and abort slow tools', async () => {
      const registry = new ToolRegistry(true);
      const safeExecutor = new SafeExecutor(registry, undefined, { defaultTimeoutMs: 50 });

      // Simulate a tool taking 120ms
      safeExecutor.getMockExecutor().configureMock('calculator', {
        simulatedLatencyMs: 120,
      });

      const res = await safeExecutor.executeTool({
        requestId: 'r_timeout',
        workflowId: 'wf_timeout',
        stepId: 's1',
        toolName: 'calculator',
        parameters: { expression: '1 + 1' },
        riskLevel: RiskLevel.A_INFORMATIONAL,
        timeoutMs: 40, // 40ms timeout vs 120ms latency
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('TOOL_TIMEOUT');
      expect(res.error?.message).toContain('timed out after 40ms limit');
    });

    it('should execute bounded retries for IDEMPOTENT calls only', async () => {
      const registry = new ToolRegistry(true);
      const safeExecutor = new SafeExecutor(registry, undefined, { maxBoundedRetries: 3 });

      let attempts = 0;
      safeExecutor.getMockExecutor().configureMock('calculator', {
        mockHandler: () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('Transient computation failure');
            (err as { code?: string }).code = 'TRANSIENT_CALC_ERR';
            throw err;
          }
          return { result: 100 };
        },
      });

      // Calculator is idempotent (isIdempotent: true)
      const res = await safeExecutor.executeTool(
        {
          requestId: 'r_retry_idempotent',
          workflowId: 'wf_retry',
          stepId: 's_calc',
          toolName: 'calculator',
          parameters: { expression: '10 * 10' },
          riskLevel: RiskLevel.A_INFORMATIONAL,
        },
        {
          isIdempotent: true,
          retryPolicy: {
            maxAttempts: 4,
            backoffMs: 5,
            backoffMultiplier: 1.5,
          },
        }
      );

      expect(res.success).toBe(true);
      expect(res.data).toEqual({ result: 100 });
      // Succeeded on 3rd attempt via bounded retries
      expect(attempts).toBe(3);
    });

    it('CRITICAL: NON-IDEMPOTENT calls are NEVER retried on failure (fails on attempt 1)', async () => {
      const registry = new ToolRegistry(true);
      // Register custom non-idempotent tool (e.g. transfer or mutate state)
      registry.register({
        name: 'mutate_record',
        description: 'Mutates state',
        purpose: 'Non-idempotent operation',
        riskLevel: RiskLevel.B_LOW_RISK,
        isIdempotent: false, // NON-IDEMPOTENT!
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'id' } },
          required: ['id'],
        },
        failureBehavior: 'ABORT',
      });

      const safeExecutor = new SafeExecutor(registry);

      let invocationCount = 0;
      safeExecutor.getMockExecutor().configureMock('mutate_record', {
        mockHandler: () => {
          invocationCount++;
          throw new Error('Database connection reset during state mutation');
        },
      });

      // Even with a retryPolicy specifying maxAttempts: 5, non-idempotent call must NOT retry!
      const res = await safeExecutor.executeTool(
        {
          requestId: 'r_non_idempotent',
          workflowId: 'wf_mut',
          stepId: 's_mut',
          toolName: 'mutate_record',
          parameters: { id: 'item_123' },
          riskLevel: RiskLevel.B_LOW_RISK,
        },
        {
          isIdempotent: false,
          retryPolicy: {
            maxAttempts: 5,
            backoffMs: 10,
            backoffMultiplier: 2,
          },
        }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('EXECUTION_EXCEPTION');
      // Critical Guarantee: Non-idempotent call was invoked EXACTLY ONCE (0 retries)
      expect(invocationCount).toBe(1);
    });

    it('should support cancellation and immediately halt in-flight execution', async () => {
      const registry = new ToolRegistry(true);
      const safeExecutor = new SafeExecutor(registry);

      // Tool with 200ms latency
      safeExecutor.getMockExecutor().configureMock('summarize_text', {
        simulatedLatencyMs: 200,
      });

      const abortCtrl = new AbortController();

      // Trigger execution
      const execPromise = safeExecutor.executeTool({
        requestId: 'r_cancel',
        workflowId: 'wf_cancel',
        stepId: 's_summ',
        toolName: 'summarize_text',
        parameters: { text: 'Content to abort' },
        riskLevel: RiskLevel.A_INFORMATIONAL,
        signal: abortCtrl.signal,
      });

      // Abort after 25ms
      setTimeout(() => {
        abortCtrl.abort('User stopped workflow from voice command');
      }, 25);

      const res = await execPromise;
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('EXECUTION_CANCELLED');
      expect(res.error?.message).toContain('User stopped workflow');
    });

    it('should support orchestrator cancellation and skip remaining workflow steps', async () => {
      const registry = new ToolRegistry(true);
      const executor = new MockToolExecutor(registry);
      const orchestrator = new WorkflowOrchestrator(executor);

      const builder = new WorkflowBuilder('wf_cancel_multi', 'Multi-step Cancellation');
      builder.addToolStep('step1', 'Step 1', 'calculator', { expression: '1+1' });
      builder.addToolStep('step2', 'Step 2', 'summarize_text', { text: 'Some long text' });
      builder.addToolStep('step3', 'Step 3', 'calculator', { expression: '2+2' });
      builder.addTransition('step1', 'step2');
      builder.addTransition('step2', 'step3');

      const plan = builder.build();
      const context = createMockContext('wf_cancel_multi_ctx');

      // Cancel after step1 starts
      orchestrator.on('stepStarted', ({ stepId }) => {
        if (stepId === 'step1') {
          void orchestrator.cancel('Cancelled during first step');
        }
      });

      const res = await orchestrator.executeWorkflow(plan, context);

      expect(res.success).toBe(false);
      expect(res.finalState).toBe(WorkflowState.ABORTED);
      expect(res.error?.code).toBe('WORKFLOW_CANCELLED');
      // step2 and step3 were never executed
      expect(res.executedSteps).not.toContain('step2');
      expect(res.executedSteps).not.toContain('step3');
    });
  });

  // =========================================================================
  // 5. Full Orchestration: Approved Plan vs Rejected Plan
  // =========================================================================
  describe('Full Workflow Orchestration — Approved Plan vs Rejected Plan', () => {
    it('Scenario A: Plan Validation rejects plan with cycles before execution starts', async () => {
      const orchestrator = new WorkflowOrchestrator(new MockToolExecutor());

      const cyclicPlan: WorkflowPlan = {
        id: 'plan_rejected_cycle',
        name: 'Cyclic Plan',
        version: '1.0.0',
        description: 'Contains dependency cycle',
        initialStepId: 'step_1',
        steps: [
          {
            id: 'step_1',
            name: 'Step 1',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '1 + 1' },
            description: '',
            dependencies: ['step_2'],
          },
          {
            id: 'step_2',
            name: 'Step 2',
            type: StepType.TOOL_EXECUTION,
            toolName: 'summarize_text',
            toolParameters: { text: 'Sample' },
            description: '',
            dependencies: ['step_1'],
          },
        ],
        transitions: [],
      };

      const result = await orchestrator.executeWorkflow(
        cyclicPlan,
        createMockContext('wf_val_cycle'),
        { validatePlan: true }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PLAN_VALIDATION_ERROR');
      expect(result.error?.message).toContain('Dependency cycle detected');
      expect(result.executedSteps.length).toBe(0);
    });

    it('Scenario B: Approved Plan executes to completion', async () => {
      const safetyGate = new SafetyGate();
      const executor = new MockToolExecutor(undefined, safetyGate);
      const orchestrator = new WorkflowOrchestrator(executor, safetyGate);

      const builder = new WorkflowBuilder('wf_approved', 'Approved Plan');
      builder.addToolStep('step_calc', 'Compute', 'calculator', { expression: '25 + 75' });
      builder.addToolStep(
        'step_sensitive_analysis',
        'Sensitive Analysis',
        'summarize_text',
        { text: 'Confidential research document findings' },
        { riskLevel: RiskLevel.C_SENSITIVE }
      );
      builder.addTransition('step_calc', 'step_sensitive_analysis');

      const plan = builder.build();
      const context = createMockContext('wf_approved_ctx');

      // Auto-approve when approval is requested
      orchestrator.on('approvalRequested', (req) => {
        setTimeout(() => {
          orchestrator.submitApproval(req.stepId, true, 'User reviewed and approved');
        }, 10);
      });

      const result = await orchestrator.executeWorkflow(plan, context);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe(WorkflowState.COMPLETED);
      expect(result.executedSteps).toContain('step_calc');
      expect(result.executedSteps).toContain('step_sensitive_analysis');
    });

    it('Scenario C: Rejected Plan safely halts; sensitive action NEVER executes', async () => {
      const safetyGate = new SafetyGate();
      const executor = new MockToolExecutor(undefined, safetyGate);
      const orchestrator = new WorkflowOrchestrator(executor, safetyGate);

      const toolSpy = vi.fn();
      executor.configureMock('summarize_text', {
        mockHandler: toolSpy,
      });

      const builder = new WorkflowBuilder('wf_rejected', 'Rejected Plan');
      builder.addToolStep('step_calc', 'Compute', 'calculator', { expression: '5 * 5' });
      builder.addToolStep(
        'step_sensitive_action',
        'Sensitive Action',
        'summarize_text',
        { text: 'Critical data summary' },
        { riskLevel: RiskLevel.C_SENSITIVE }
      );
      builder.addTransition('step_calc', 'step_sensitive_action');

      const plan = builder.build();
      const context = createMockContext('wf_rejected_ctx');

      // User REJECTS when approval is requested
      orchestrator.on('approvalRequested', (req) => {
        setTimeout(() => {
          orchestrator.submitApproval(req.stepId, false, 'Security: User denied sensitive action');
        }, 10);
      });

      const result = await orchestrator.executeWorkflow(plan, context);

      expect(result.success).toBe(false);
      expect(result.executedSteps).toContain('step_calc');
      // Sensitive action step was NOT completed
      expect(result.executedSteps).not.toContain('step_sensitive_action');

      // Invariant: The sensitive tool was NEVER executed!
      expect(toolSpy).toHaveBeenCalledTimes(0);

      // Verify log records rejection
      expect(
        context.logs.some((l) => l.message.includes('User rejected execution'))
      ).toBe(true);
    });

    it('should test detectTransitionCycles option and invalid parameter schemas in PlanValidator', () => {
      const registry = new ToolRegistry(true);
      const validator = new PlanValidator(registry);

      // Transition cycle test
      const planWithTransCycle: WorkflowPlan = {
        id: 'plan_trans_cycle',
        name: 'Trans Cycle',
        version: '1.0.0',
        description: '',
        initialStepId: 's1',
        steps: [
          { id: 's1', name: 'Step 1', type: StepType.REASONING, description: '' },
          { id: 's2', name: 'Step 2', type: StepType.REASONING, description: '' },
        ],
        transitions: [
          { fromStepId: 's1', toStepId: 's2' },
          { fromStepId: 's2', toStepId: 's1' },
        ],
      };

      const transRes = validator.validate(planWithTransCycle, { detectTransitionCycles: true });
      expect(transRes.isValid).toBe(false);
      expect(transRes.errors.some((e) => e.code === 'TRANSITION_CYCLE_DETECTED')).toBe(true);

      // Invalid static parameter schema test
      const planWithBadParams: WorkflowPlan = {
        id: 'plan_bad_params',
        name: 'Bad Params',
        version: '1.0.0',
        description: '',
        initialStepId: 's1',
        steps: [
          {
            id: 's1',
            name: 'Step 1',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: 12345 as unknown as string }, // should be string
            description: '',
          },
        ],
        transitions: [],
      };

      const badParamRes = validator.validate(planWithBadParams);
      expect(badParamRes.isValid).toBe(false);
      expect(badParamRes.errors.some((e) => e.code === 'INVALID_PARAMETERS')).toBe(true);
    });

    it('should execute full plan via SafeExecutor.executePlan and enforce pre-validation', async () => {
      const safeExecutor = new SafeExecutor();

      // 1. Valid plan execution
      const validPlan: WorkflowPlan = {
        id: 'plan_safe_exec',
        name: 'Safe Plan',
        version: '1.0.0',
        description: '',
        initialStepId: 's1',
        steps: [
          {
            id: 's1',
            name: 'Compute',
            type: StepType.TOOL_EXECUTION,
            toolName: 'calculator',
            toolParameters: { expression: '12 + 13' },
            description: '',
          },
        ],
        transitions: [],
      };

      const validResult = await safeExecutor.executePlan(
        validPlan,
        createMockContext('wf_safe_ok')
      );
      expect(validResult.success).toBe(true);
      expect(validResult.executedSteps).toContain('s1');

      // 2. Invalid plan execution fails at validation stage
      const invalidPlan: WorkflowPlan = {
        id: 'plan_safe_invalid',
        name: 'Invalid Plan',
        version: '1.0.0',
        description: '',
        initialStepId: 's_ghost',
        steps: [{ id: 's1', name: 'S1', type: StepType.REASONING, description: '' }],
        transitions: [],
      };

      const invalidResult = await safeExecutor.executePlan(
        invalidPlan,
        createMockContext('wf_safe_inv')
      );
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error?.code).toBe('PLAN_VALIDATION_ERROR');
    });

    it('should test approval manager state edge cases: double approve, reject already expired, not found', async () => {
      const manager = new ApprovalManager();

      // 1. Not found
      expect(() => manager.assertCanExecute('non_existent_id')).toThrow(
        ActionExecutionBlockedError
      );

      // 2. Pending
      const req = manager.createRequest({
        workflowId: 'wf_edge',
        stepId: 's1',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '1' },
      });
      expect(() => manager.assertCanExecute(req.approvalId)).toThrow(ActionExecutionBlockedError);

      // 3. Double approve returns existing decision
      const d1 = manager.approve(req.approvalId);
      const d2 = manager.approve(req.approvalId);
      expect(d1).toEqual(d2);

      // 4. Reject expired request throws
      const expReq = manager.createRequest({
        workflowId: 'wf_edge2',
        stepId: 's2',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '1' },
        ttlMs: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(() => manager.reject(expReq.approvalId)).toThrow(ApprovalExpiredError);

      // 5. Approve rejected request throws
      const rejReq = manager.createRequest({
        workflowId: 'wf_edge3',
        stepId: 's3',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '1' },
      });
      manager.reject(rejReq.approvalId, 'No');
      expect(() => manager.approve(rejReq.approvalId)).toThrow();
    });
  });
});
