/**
 * Week 3 Day 21 Team Gate End-to-End Integration Test Suite
 * Validates the complete integrated flow:
 * Audio Voice Input -> Transcription -> Reasoning Proposal -> Plan Validation ->
 * Checkpointing -> Step-Level Audit Trail & Progress Events -> Backend Approval Gate ->
 * Safe Tool Execution -> Completion.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import { CheckpointManager } from '../src/checkpoint/CheckpointManager.js';
import { IdempotencyManager } from '../src/safety/IdempotencyManager.js';
import { AuditTrail } from '../src/audit/AuditTrail.js';
import { ProposalManager } from '../src/reasoning/ProposalManager.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import {
  WorkflowProposal,
  WorkflowState,
  RiskLevel,
  StepType,
  ProgressEvent,
  AuditEventType,
} from '../src/types/index.js';

describe('Week 3 (D21) Team Gate: End-to-End Session Integration Suite', () => {
  let toolExecutor: MockToolExecutor;
  let safetyGate: SafetyGate;
  let checkpointManager: CheckpointManager;
  let idempotencyManager: IdempotencyManager;
  let auditTrail: AuditTrail;
  let proposalManager: ProposalManager;
  let orchestrator: WorkflowOrchestrator;

  beforeEach(() => {
    toolExecutor = new MockToolExecutor();
    safetyGate = new SafetyGate();
    checkpointManager = new CheckpointManager();
    idempotencyManager = new IdempotencyManager();
    auditTrail = new AuditTrail();
    proposalManager = new ProposalManager();

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

  it('Day 21 Team Gate: Complete session flows from voice input to UI approval and verified audit trail', async () => {
    const progressList: ProgressEvent[] = [];
    orchestrator.on('progress', (p) => progressList.push(p));

    // 1. Upstream voice capture & transcription mock
    const voiceInput = 'Compute final exam scores and prepare summarized grade statistics';
    const transcription = 'compute final exam scores and prepare summarized grade statistics';

    // 2. Upstream Reasoning generates a multi-step WorkflowProposal
    const plan = new WorkflowBuilder('wf_academic_session', 'Academic Grade Processing Session')
      .addReasoningStep('step_rsn_init', 'Analyze Voice Request Intent')
      .addToolStep(
        'step_math_calc',
        'Calculate Weighted Average',
        'calculator',
        { expression: '(78 * 0.4) + (92 * 0.6)' },
        { riskLevel: RiskLevel.A_INFORMATIONAL }
      )
      .addToolStep(
        'step_sensitive_summary',
        'Summarize Grade Distribution',
        'summarize_text',
        { text: 'Final grades: Class mean 86.4%, standard deviation 5.2%. No anomalies detected.' },
        { riskLevel: RiskLevel.C_SENSITIVE } // Requires Human Authorization
      )
      .addResponseStep('step_voice_response', 'Formulate Voice Feedback to Instructor')
      .addSequentialTransitions()
      .build();

    const proposal: WorkflowProposal = {
      proposalId: 'prop_sess_2026_w3',
      sessionId: 'sess_live_audio_classroom_101',
      rawVoiceInput: voiceInput,
      transcription,
      intent: 'process_academic_grades',
      confidence: 0.98,
      proposedPlan: plan,
      explanation: 'Evaluates grade formula via calculator and summarizes results with sensitive authorization gate.',
      riskAssessment: {
        highestRiskLevel: RiskLevel.C_SENSITIVE,
        requiresApproval: true,
        reasons: ['Modifies student performance statistical summary'],
      },
      timestamp: Date.now(),
    };

    // 3. Evaluate proposal
    const evaluation = proposalManager.evaluateProposal(proposal);
    expect(evaluation.accepted).toBe(true);
    expect(evaluation.requiresApproval).toBe(true);

    // 4. Setup automated UI approval interaction
    orchestrator.on('approvalRequested', (approvalReq) => {
      // Backend approval state is inspectable
      const backendState = safetyGate.getApprovalManager().getApprovalState(approvalReq.approvalId);
      expect(backendState).not.toBeNull();
      expect(backendState?.status).toBe('PENDING');

      // UI submits approval after inspectable delay
      setTimeout(() => {
        orchestrator.submitApproval(approvalReq.stepId, true, 'Instructor authorized via UI button');
      }, 20);
    });

    // 5. Execute proposal through orchestrator
    const result = await proposalManager.executeProposal(proposal, orchestrator);

    // 6. Verify Execution Success
    expect(result.success).toBe(true);
    expect(result.finalState).toBe(WorkflowState.COMPLETED);
    expect(result.executedSteps).toEqual([
      'step_rsn_init',
      'step_math_calc',
      'step_sensitive_summary',
      'step_voice_response',
    ]);

    // 7. Verify Checkpointing
    const checkpoints = await checkpointManager.listCheckpoints('wf_academic_session');
    expect(checkpoints.length).toBeGreaterThanOrEqual(4);
    const preApprovalCkpt = checkpoints.find((c) => c.metadata?.awaitingApprovalForStep === 'step_sensitive_summary');
    expect(preApprovalCkpt).toBeDefined();

    // 8. Verify Progress Events (Monotonicity and Coverage)
    expect(progressList.length).toBeGreaterThanOrEqual(5);
    expect(progressList[0].percentage).toBe(0);
    expect(progressList[progressList.length - 1].percentage).toBe(100);
    expect(progressList[progressList.length - 1].status).toBe('completed');

    // 9. Verify Cryptographic Audit Trail Hash Chain Integrity
    const auditRecords = auditTrail.getRecords('wf_academic_session');
    expect(auditRecords.length).toBeGreaterThanOrEqual(8);

    const auditEventTypes = auditRecords.map((r) => r.eventType);
    expect(auditEventTypes).toContain(AuditEventType.WORKFLOW_STARTED);
    expect(auditEventTypes).toContain(AuditEventType.APPROVAL_REQUESTED);
    expect(auditEventTypes).toContain(AuditEventType.APPROVAL_GRANTED);
    expect(auditEventTypes).toContain(AuditEventType.TOOL_INVOKED);
    expect(auditEventTypes).toContain(AuditEventType.WORKFLOW_COMPLETED);

    const integrity = auditTrail.verifyIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalRecords).toBe(auditRecords.length);
  });

  it('Day 21 Team Gate: Failure, Checkpoint & Clean Resume Session', async () => {
    // Calculator fails once on step 2
    toolExecutor.configureMock('calculator', {
      failNTimes: 1,
      failureErrorCode: 'TRANSIENT_COMPUTE_OVERLOAD',
      failureErrorMessage: 'Compute node temporarily unavailable',
    });

    const plan = new WorkflowBuilder('wf_recovery_session', 'Failure Recovery Session')
      .addReasoningStep('step_init_analysis', 'Data Ingestion')
      .addToolStep('step_fragile_calc', 'Transient Calculation', 'calculator', { expression: '125 * 4' })
      .addResponseStep('step_final_response', 'Deliver Response')
      .addSequentialTransitions()
      .build();

    const proposal: WorkflowProposal = {
      proposalId: 'prop_fail_resume_01',
      sessionId: 'sess_rec',
      intent: 'resilient_analysis',
      confidence: 0.9,
      proposedPlan: plan,
      explanation: 'Verifies recovery from transient failure',
      riskAssessment: { highestRiskLevel: RiskLevel.A_INFORMATIONAL, requiresApproval: false, reasons: [] },
      timestamp: Date.now(),
    };

    // First run fails at step_fragile_calc
    const firstRun = await orchestrator.executeWorkflow(
      proposal.proposedPlan,
      proposalManager.createContextFromProposal(proposal)
    );
    expect(firstRun.success).toBe(false);

    // Verify failure checkpoint exists
    const checkpoints = await checkpointManager.listCheckpoints('wf_recovery_session');
    const failCkpt = checkpoints.find((c) => c.status === 'FAILED');
    expect(failCkpt).toBeDefined();
    expect(failCkpt?.completedStepIds).toContain('step_init_analysis');

    // Simulate backend recovery
    toolExecutor.configureMock('calculator', { failNTimes: 0 });

    const toolSpy = vi.spyOn(toolExecutor, 'execute');

    // Resume from checkpoint
    const resumedRun = await orchestrator.resumeWorkflow(failCkpt!.checkpointId);
    expect(resumedRun.success).toBe(true);
    expect(resumedRun.finalState).toBe(WorkflowState.COMPLETED);

    // INVARIANT: Step 1 was NOT re-run during resumption; ONLY fragile_calc ran
    expect(toolSpy).toHaveBeenCalledTimes(1);
    expect(toolSpy).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'step_fragile_calc' }));
  });
});
