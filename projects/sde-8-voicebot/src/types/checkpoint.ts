/**
 * Checkpoint & Resume Schemas & Types
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { WorkflowPlan, WorkflowState } from './workflow.js';

export enum CheckpointStatus {
  ACTIVE = 'ACTIVE',
  RESUMED = 'RESUMED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

export interface WorkflowCheckpoint {
  checkpointId: string;
  workflowId: string;
  executionId: string;
  plan: WorkflowPlan;
  stepId: string; // The step just completed or currently awaiting action/approval
  completedStepIds: string[]; // Step IDs successfully completed before this checkpoint
  stepResults: Record<string, unknown>; // Cached results of finished steps
  variables: Record<string, unknown>; // Snapshot of context.variables
  state: WorkflowState; // State machine state at the checkpoint
  attemptsPerStep: Record<string, number>;
  approvals: Record<string, boolean>;
  timestamp: number;
  status: CheckpointStatus;
  failedStepId?: string;
  error?: {
    message: string;
    code?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface CheckpointStore {
  save(checkpoint: WorkflowCheckpoint): Promise<void> | void;
  get(checkpointId: string): Promise<WorkflowCheckpoint | null> | WorkflowCheckpoint | null;
  list(workflowId?: string): Promise<WorkflowCheckpoint[]> | WorkflowCheckpoint[];
  getLatest(workflowId: string): Promise<WorkflowCheckpoint | null> | WorkflowCheckpoint | null;
  delete(checkpointId: string): Promise<boolean> | boolean;
  clear(workflowId?: string): Promise<void> | void;
}

export interface ResumeOptions {
  overrideVariables?: Record<string, unknown>;
  validatePlan?: boolean;
}
