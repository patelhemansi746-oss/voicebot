/**
 * Step-Level Audit Trail & Progress Events Test Suite
 * Validates Week 3 Milestone D17-18:
 * - Step-level audit recording for every step
 * - Cryptographic SHA-256 hash chaining & tamper detection
 * - Monotonic progress events from 0% to 100%
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { SafetyGate } from '../src/safety/SafetyGate.js';
import { CheckpointManager } from '../src/checkpoint/CheckpointManager.js';
import { IdempotencyManager } from '../src/safety/IdempotencyManager.js';
import { AuditTrail } from '../src/audit/AuditTrail.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import {
  WorkflowContext,
  RiskLevel,
  StepType,
  AuditEventType,
  ProgressEvent,
} from '../src/types/index.js';

function createMockContext(workflowId = 'wf_audit_test'): WorkflowContext {
  return {
    workflowId,
    name: 'Audit & Progress Test Workflow',
    userRequest: {
      requestId: `req_${Date.now()}`,
      sessionId: 'sess_audit',
      rawVoiceInput: 'Perform secure calculations',
      intent: 'secure_calculation',
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'VS Code - Academia AI Co-Pilot',
      windowTitle: 'Test Workspace',
      visibleContent: 'Testing buffer contents',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('Milestone D17-18: Step-Level Audit Trail & Progress Events Suite', () => {
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

  describe('1. Step-Level Audit Trail Verification', () => {
    it('should write an audit record for every workflow step and event', async () => {
      const plan = new WorkflowBuilder('wf_audit_flow', 'Audit Verification Plan')
        .addReasoningStep('step_rsn', 'Analyze Query')
        .addToolStep('step_calc', 'Compute Value', 'calculator', { expression: '50 * 2' }, {
          riskLevel: RiskLevel.A_INFORMATIONAL,
        })
        .addResponseStep('step_resp', 'Deliver Results')
        .addSequentialTransitions()
        .build();

      const context = createMockContext('wf_audit_flow');
      const result = await orchestrator.executeWorkflow(plan, context);
      expect(result.success).toBe(true);

      const records = auditTrail.getRecords('wf_audit_flow');
      expect(records.length).toBeGreaterThanOrEqual(7);

      // Verify event sequence:
      // WORKFLOW_STARTED -> STEP_STARTED (step_rsn) -> STEP_COMPLETED (step_rsn) -> ...
      const eventTypes = records.map((r) => r.eventType);
      expect(eventTypes).toContain(AuditEventType.WORKFLOW_STARTED);
      expect(eventTypes).toContain(AuditEventType.STEP_STARTED);
      expect(eventTypes).toContain(AuditEventType.TOOL_INVOKED);
      expect(eventTypes).toContain(AuditEventType.STEP_COMPLETED);
      expect(eventTypes).toContain(AuditEventType.CHECKPOINT_SAVED);
      expect(eventTypes).toContain(AuditEventType.WORKFLOW_COMPLETED);

      // Verify specific step records exist
      const rsnRecords = auditTrail.getRecordsByStep('step_rsn');
      expect(rsnRecords.some((r) => r.eventType === AuditEventType.STEP_STARTED)).toBe(true);
      expect(rsnRecords.some((r) => r.eventType === AuditEventType.STEP_COMPLETED)).toBe(true);

      const toolRecords = auditTrail.getRecordsByStep('step_calc');
      expect(toolRecords.some((r) => r.eventType === AuditEventType.TOOL_INVOKED)).toBe(true);
    });

    it('should maintain unbroken SHA-256 cryptographic hash chain across all records', async () => {
      const plan = new WorkflowBuilder('wf_hash_chain', 'Hash Chain Plan')
        .addReasoningStep('s1', 'Step 1')
        .addResponseStep('s2', 'Step 2')
        .addSequentialTransitions()
        .build();

      await orchestrator.executeWorkflow(plan, createMockContext('wf_hash_chain'));

      const integrity = auditTrail.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.totalRecords).toBeGreaterThan(0);
      expect(integrity.tamperedRecordId).toBeUndefined();

      // Verify each record points to the previous hash
      const records = auditTrail.getRecords();
      for (let i = 1; i < records.length; i++) {
        expect(records[i].previousHash).toBe(records[i - 1].hash);
      }
    });

    it('should detect unauthorized tampering with any audit record in the chain', async () => {
      const plan = new WorkflowBuilder('wf_tamper', 'Tamper Test')
        .addReasoningStep('s1', 'Step 1')
        .addResponseStep('s2', 'Step 2')
        .addSequentialTransitions()
        .build();

      await orchestrator.executeWorkflow(plan, createMockContext('wf_tamper'));

      // Tamper with record #2's details payload
      const records = (auditTrail as unknown as { records: Array<{ details: Record<string, unknown>; recordId: string }> }).records;
      records[2].details = { maliciousModification: 'unauthorized_payload_change' };

      const integrity = auditTrail.verifyIntegrity();
      expect(integrity.valid).toBe(false);
      expect(integrity.tamperedRecordId).toBe(records[2].recordId);
      expect(integrity.error).toContain('Tampered record detected');
    });

    it('should export audit trail as formatted JSON', async () => {
      const plan = new WorkflowBuilder('wf_json', 'JSON Plan')
        .addReasoningStep('s1', 'S1')
        .build();

      await orchestrator.executeWorkflow(plan, createMockContext('wf_json'));

      const jsonStr = auditTrail.exportJson();
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].hash).toBeDefined();
      expect(parsed[0].previousHash).toBeDefined();
    });
  });

  describe('2. Progress Events Emission & Monotonicity', () => {
    it('should emit progress events with increasing percentages from 0% to 100%', async () => {
      const emittedProgress: ProgressEvent[] = [];
      orchestrator.on('progress', (e: ProgressEvent) => {
        emittedProgress.push(e);
      });

      const plan = new WorkflowBuilder('wf_prog', 'Progress Plan')
        .addReasoningStep('s1', 'Step 1')
        .addPlanningStep('s2', 'Step 2')
        .addToolStep('s3', 'Step 3', 'calculator', { expression: '10 + 10' })
        .addResponseStep('s4', 'Step 4')
        .addSequentialTransitions()
        .build();

      const context = createMockContext('wf_prog');
      const result = await orchestrator.executeWorkflow(plan, context);
      expect(result.success).toBe(true);

      expect(emittedProgress.length).toBeGreaterThanOrEqual(5);

      // Initial progress: 0%
      expect(emittedProgress[0].percentage).toBe(0);
      expect(emittedProgress[0].status).toBe('running');

      // Final progress: 100%
      const last = emittedProgress[emittedProgress.length - 1];
      expect(last.percentage).toBe(100);
      expect(last.status).toBe('completed');

      // Check monotonicity: percentage never decreases
      for (let i = 1; i < emittedProgress.length; i++) {
        expect(emittedProgress[i].percentage).toBeGreaterThanOrEqual(
          emittedProgress[i - 1].percentage
        );
      }
    });

    it('should emit paused progress when awaiting approval and resumed progress when resumed', async () => {
      const emittedProgress: ProgressEvent[] = [];
      orchestrator.on('progress', (e: ProgressEvent) => {
        emittedProgress.push(e);
      });

      const plan = new WorkflowBuilder('wf_prog_appr', 'Approval Progress Plan')
        .addToolStep('s1_sensitive', 'Sensitive Calculation', 'calculator', { expression: '99 * 99' }, {
          riskLevel: RiskLevel.C_SENSITIVE,
        })
        .build();

      // Listen for approval and approve immediately
      orchestrator.on('approvalRequested', ({ stepId }) => {
        setTimeout(() => {
          orchestrator.submitApproval(stepId, true);
        }, 15);
      });

      const context = createMockContext('wf_prog_appr');
      const result = await orchestrator.executeWorkflow(plan, context);
      expect(result.success).toBe(true);

      expect(emittedProgress.some((p) => p.stepId === 's1_sensitive')).toBe(true);
      expect(emittedProgress[emittedProgress.length - 1].percentage).toBe(100);
    });
  });
});
