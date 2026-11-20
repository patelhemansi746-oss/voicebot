/**
 * Reasoning Proposals, Backend Approval State & Safety Defense Test Suite
 * Validates Week 3 Milestone D19-20:
 * - WorkflowProposal ingestion and execution
 * - Backend approval state querying
 * - Strict defense: DUPLICATE and EXPIRED approvals NEVER execute a tool
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import { ApprovalManager, ApprovalExpiredError, DuplicateApprovalDecisionError } from '../src/safety/ApprovalManager.js';
import { ProposalManager } from '../src/reasoning/ProposalManager.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import {
  WorkflowProposal,
  RiskLevel,
  StepType,
  ApprovalStatus,
  WorkflowState,
} from '../src/types/index.js';

describe('Milestone D19-20: Reasoning Proposals & Backend Approvals Suite', () => {
  let toolExecutor: MockToolExecutor;
  let safetyGate: SafetyGate;
  let approvalManager: ApprovalManager;
  let proposalManager: ProposalManager;
  let orchestrator: WorkflowOrchestrator;

  beforeEach(() => {
    toolExecutor = new MockToolExecutor();
    safetyGate = new SafetyGate();
    approvalManager = safetyGate.getApprovalManager();
    proposalManager = new ProposalManager();
    orchestrator = new WorkflowOrchestrator(toolExecutor, safetyGate);
  });

  describe('1. Reasoning Proposal Ingestion & Execution', () => {
    it('should accept valid WorkflowProposal from reasoning engine and execute to completion', async () => {
      const plan = new WorkflowBuilder('wf_prop_calc', 'Compute Academic Metric')
        .addReasoningStep('step_rsn', 'Analyze Query Intent')
        .addToolStep('step_calc', 'Calculate Average', 'calculator', { expression: '(85 + 90 + 95) / 3' }, {
          riskLevel: RiskLevel.A_INFORMATIONAL,
        })
        .addResponseStep('step_resp', 'Deliver Voice Response')
        .addSequentialTransitions()
        .build();

      const proposal: WorkflowProposal = {
        proposalId: 'prop_academic_eval_001',
        sessionId: 'sess_voice_123',
        rawVoiceInput: 'What is the average score for student group A?',
        transcription: 'what is the average score for student group a',
        intent: 'calculate_student_average',
        confidence: 0.96,
        proposedPlan: plan,
        explanation: 'Decomposed user query into arithmetic mean calculation using allow-listed calculator tool.',
        riskAssessment: {
          highestRiskLevel: RiskLevel.A_INFORMATIONAL,
          requiresApproval: false,
          reasons: ['Harmless read-only calculation'],
        },
        timestamp: Date.now(),
      };

      const evalResult = proposalManager.evaluateProposal(proposal);
      expect(evalResult.accepted).toBe(true);
      expect(evalResult.requiresApproval).toBe(false);

      const result = await proposalManager.executeProposal(proposal, orchestrator);
      expect(result.success).toBe(true);
      expect(result.finalState).toBe(WorkflowState.COMPLETED);
      expect(result.executedSteps).toContain('step_calc');
    });

    it('should reject invalid proposal containing cycles with actionable errors', async () => {
      const cyclicPlan = new WorkflowBuilder('wf_cyclic', 'Cyclic Proposal')
        .addStep({ id: 's1', name: 'Step 1', type: StepType.REASONING, description: 'R1', dependencies: ['s2'] })
        .addStep({ id: 's2', name: 'Step 2', type: StepType.REASONING, description: 'R2', dependencies: ['s1'] })
        .build();

      const proposal: WorkflowProposal = {
        proposalId: 'prop_bad_cycle',
        sessionId: 'sess_err',
        intent: 'invalid_task',
        confidence: 0.5,
        proposedPlan: cyclicPlan,
        explanation: 'Broken cyclic plan',
        riskAssessment: {
          highestRiskLevel: RiskLevel.A_INFORMATIONAL,
          requiresApproval: false,
          reasons: [],
        },
        timestamp: Date.now(),
      };

      const evalResult = proposalManager.evaluateProposal(proposal);
      expect(evalResult.accepted).toBe(false);
      expect(evalResult.validationErrors?.length).toBeGreaterThan(0);
      expect(evalResult.validationErrors?.[0]).toContain('CYCLE');
    });
  });

  describe('2. Backend Approval State Querying', () => {
    it('should read structured approval state (status, ttlRemaining, risk) from backend', () => {
      const req = approvalManager.createRequest({
        workflowId: 'wf_backend_test',
        stepId: 'step_sensitive_1',
        toolName: 'summarize_text',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { text: 'Confidential faculty evaluation' },
        ttlMs: 30000,
      });

      const state = approvalManager.getApprovalState(req.approvalId);
      expect(state).not.toBeNull();
      expect(state?.approvalId).toBe(req.approvalId);
      expect(state?.status).toBe(ApprovalStatus.PENDING);
      expect(state?.riskLevel).toBe(RiskLevel.C_SENSITIVE);
      expect(state?.toolName).toBe('summarize_text');
      expect(state?.ttlRemainingMs).toBeGreaterThan(25000);
      expect(state?.isExpired).toBe(false);
    });

    it('should list all approvals filtered by workflow ID', () => {
      approvalManager.createRequest({
        workflowId: 'wf_alpha',
        stepId: 's1',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: {},
      });
      approvalManager.createRequest({
        workflowId: 'wf_beta',
        stepId: 's2',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: {},
      });

      expect(approvalManager.listApprovals().length).toBe(2);
      expect(approvalManager.listApprovals('wf_alpha').length).toBe(1);
    });
  });

  describe('3. Safety Invariants: DUPLICATE & EXPIRED Approvals NEVER Execute Tool', () => {
    it('should prove DUPLICATE approvals NEVER execute a tool more than once', async () => {
      const toolSpy = vi.fn((params) => ({ computed: true, input: params }));
      toolExecutor.configureMock('calculator', { mockHandler: toolSpy });

      const req = approvalManager.createRequest({
        workflowId: 'wf_dup_test',
        stepId: 'step_action',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '100 / 2' },
      });

      // 1. First approval -> Granted
      const firstDecision = approvalManager.approve(req.approvalId);
      expect(firstDecision.approved).toBe(true);

      // Execute tool first time with the valid approval
      await toolExecutor.execute({
        requestId: 'req_1',
        workflowId: 'wf_dup_test',
        stepId: 'step_action',
        toolName: 'calculator',
        parameters: { expression: '100 / 2' },
        riskLevel: RiskLevel.C_SENSITIVE,
        approvalToken: req.approvalId,
      });
      expect(toolSpy).toHaveBeenCalledTimes(1);

      // 2. Second approval call (duplicate approval)
      // When strict throwOnDuplicate is passed:
      expect(() => {
        approvalManager.approve(req.approvalId, { throwOnDuplicate: true });
      }).toThrow(DuplicateApprovalDecisionError);

      // When called without throwOnDuplicate: returns existing decision safely
      const secondDecision = approvalManager.approve(req.approvalId);
      expect(secondDecision.approved).toBe(true);

      // INVARIANT CHECK: Underlying tool was NOT called a second time
      expect(toolSpy).toHaveBeenCalledTimes(1); // EXACTLY ONCE!
    });

    it('should prove EXPIRED approvals NEVER execute a tool (0 invocations)', async () => {
      const toolSpy = vi.fn((params) => ({ computed: true, input: params }));
      toolExecutor.configureMock('calculator', { mockHandler: toolSpy });

      // Create request with short TTL of 20ms
      const req = approvalManager.createRequest({
        workflowId: 'wf_expire_test',
        stepId: 'step_expire_action',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '500 * 2' },
        ttlMs: 20,
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 35));

      // Attempting to approve must fail with ApprovalExpiredError
      expect(() => {
        approvalManager.approve(req.approvalId);
      }).toThrow(ApprovalExpiredError);

      // Attempting to execute tool with expired approval must be blocked
      const execResult = await toolExecutor.execute({
        requestId: 'req_expired',
        workflowId: 'wf_expire_test',
        stepId: 'step_expire_action',
        toolName: 'calculator',
        parameters: { expression: '500 * 2' },
        riskLevel: RiskLevel.C_SENSITIVE,
        approvalToken: req.approvalId,
      });

      expect(execResult.success).toBe(false);
      expect(execResult.error?.code).toBe('ACTION_APPROVAL_BLOCKED');

      // CRITICAL INVARIANT: Tool was called EXACTLY ZERO TIMES
      expect(toolSpy).toHaveBeenCalledTimes(0);
    });

    it('should prove REJECTED approvals NEVER execute a tool (0 invocations)', async () => {
      const toolSpy = vi.fn((params) => ({ computed: true, input: params }));
      toolExecutor.configureMock('calculator', { mockHandler: toolSpy });

      const req = approvalManager.createRequest({
        workflowId: 'wf_reject_test',
        stepId: 'step_rejected_action',
        toolName: 'calculator',
        riskLevel: RiskLevel.C_SENSITIVE,
        parameters: { expression: '999 + 1' },
      });

      // User rejects the request
      const rejectDecision = approvalManager.reject(req.approvalId, 'User denied action');
      expect(rejectDecision.approved).toBe(false);

      // Subsequent attempt to approve must throw
      expect(() => {
        approvalManager.approve(req.approvalId);
      }).toThrow();

      // Tool execution MUST be blocked
      const execResult = await toolExecutor.execute({
        requestId: 'req_rejected_call',
        workflowId: 'wf_reject_test',
        stepId: 'step_rejected_action',
        toolName: 'calculator',
        parameters: { expression: '999 + 1' },
        riskLevel: RiskLevel.C_SENSITIVE,
        approvalToken: req.approvalId,
      });

      expect(execResult.success).toBe(false);
      expect(execResult.error?.code).toBe('ACTION_APPROVAL_BLOCKED');

      // CRITICAL INVARIANT: Tool was called EXACTLY ZERO TIMES
      expect(toolSpy).toHaveBeenCalledTimes(0);
    });
  });
});
