/**
 * Audit Trail Schemas & Types
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

export enum AuditEventType {
  WORKFLOW_STARTED = 'WORKFLOW_STARTED',
  STEP_STARTED = 'STEP_STARTED',
  STEP_COMPLETED = 'STEP_COMPLETED',
  STEP_FAILED = 'STEP_FAILED',
  STEP_SKIPPED = 'STEP_SKIPPED',
  APPROVAL_REQUESTED = 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED = 'APPROVAL_GRANTED',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  APPROVAL_EXPIRED = 'APPROVAL_EXPIRED',
  CHECKPOINT_SAVED = 'CHECKPOINT_SAVED',
  WORKFLOW_RESUMED = 'WORKFLOW_RESUMED',
  TOOL_INVOKED = 'TOOL_INVOKED',
  WORKFLOW_COMPLETED = 'WORKFLOW_COMPLETED',
  WORKFLOW_FAILED = 'WORKFLOW_FAILED',
  WORKFLOW_CANCELLED = 'WORKFLOW_CANCELLED',
}

export interface AuditActor {
  type: 'SYSTEM' | 'USER' | 'AGENT';
  id: string;
  name?: string;
}

export interface AuditRecord {
  recordId: string;
  sequenceNumber: number;
  timestamp: number;
  isoTimestamp: string;
  workflowId: string;
  executionId: string;
  stepId?: string;
  stepName?: string;
  eventType: AuditEventType;
  actor: AuditActor;
  details: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalRecords: number;
  tamperedRecordId?: string;
  error?: string;
}
