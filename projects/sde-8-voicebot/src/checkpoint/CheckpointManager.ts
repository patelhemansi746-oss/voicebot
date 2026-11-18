/**
 * Checkpoint Manager
 * Manages saving and restoring workflow snapshots (context, variables, completed steps, state).
 * Enables fault-tolerant recovery without re-running completed steps.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { EventEmitter } from 'node:events';
import {
  WorkflowCheckpoint,
  CheckpointStatus,
  CheckpointStore,
} from '../types/checkpoint.js';
import {
  WorkflowPlan,
  WorkflowContext,
  WorkflowState,
} from '../types/workflow.js';

export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints: Map<string, WorkflowCheckpoint> = new Map();

  public save(checkpoint: WorkflowCheckpoint): void {
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
  }

  public get(checkpointId: string): WorkflowCheckpoint | null {
    return this.checkpoints.get(checkpointId) ?? null;
  }

  public list(workflowId?: string): WorkflowCheckpoint[] {
    const all = Array.from(this.checkpoints.values());
    if (!workflowId) return all;
    return all.filter((c) => c.workflowId === workflowId);
  }

  public getLatest(workflowId: string): WorkflowCheckpoint | null {
    const matches = this.list(workflowId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
  }

  public delete(checkpointId: string): boolean {
    return this.checkpoints.delete(checkpointId);
  }

  public clear(workflowId?: string): void {
    if (!workflowId) {
      this.checkpoints.clear();
      return;
    }
    for (const [id, c] of this.checkpoints.entries()) {
      if (c.workflowId === workflowId) {
        this.checkpoints.delete(id);
      }
    }
  }
}

export class CheckpointManager extends EventEmitter {
  private store: CheckpointStore;

  constructor(store?: CheckpointStore) {
    super();
    this.store = store ?? new InMemoryCheckpointStore();
  }

  public getStore(): CheckpointStore {
    return this.store;
  }

  /**
   * Deep-clone serializable data for snapshot isolation
   */
  private clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Save a valid progress or pre-approval checkpoint
   */
  public async saveCheckpoint(
    plan: WorkflowPlan,
    context: WorkflowContext,
    state: WorkflowState,
    stepId: string,
    completedStepIds: string[],
    options?: {
      status?: CheckpointStatus;
      metadata?: Record<string, unknown>;
    }
  ): Promise<WorkflowCheckpoint> {
    const now = Date.now();
    const checkpointId = `ckpt_${context.workflowId}_${stepId}_${now}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const checkpoint: WorkflowCheckpoint = {
      checkpointId,
      workflowId: context.workflowId,
      executionId: `exec_${context.workflowId}_${context.startTime}`,
      plan: this.clone(plan),
      stepId,
      completedStepIds: [...completedStepIds],
      stepResults: this.clone(context.stepResults),
      variables: this.clone(context.variables),
      state,
      attemptsPerStep: this.clone(context.attemptsPerStep),
      approvals: this.clone(context.approvals),
      timestamp: now,
      status: options?.status ?? CheckpointStatus.ACTIVE,
      metadata: options?.metadata ? this.clone(options.metadata) : undefined,
    };

    await this.store.save(checkpoint);
    this.emit('checkpointSaved', checkpoint);
    return checkpoint;
  }

  /**
   * Save a failure checkpoint for post-mortem analysis or recovery
   */
  public async createFailureCheckpoint(
    plan: WorkflowPlan,
    context: WorkflowContext,
    state: WorkflowState,
    failedStepId: string,
    completedStepIds: string[],
    error: { message: string; code?: string },
    metadata?: Record<string, unknown>
  ): Promise<WorkflowCheckpoint> {
    const now = Date.now();
    const checkpointId = `ckpt_fail_${context.workflowId}_${failedStepId}_${now}`;

    const checkpoint: WorkflowCheckpoint = {
      checkpointId,
      workflowId: context.workflowId,
      executionId: `exec_${context.workflowId}_${context.startTime}`,
      plan: this.clone(plan),
      stepId: failedStepId,
      completedStepIds: [...completedStepIds],
      stepResults: this.clone(context.stepResults),
      variables: this.clone(context.variables),
      state,
      attemptsPerStep: this.clone(context.attemptsPerStep),
      approvals: this.clone(context.approvals),
      timestamp: now,
      status: CheckpointStatus.FAILED,
      failedStepId,
      error,
      metadata: metadata ? this.clone(metadata) : undefined,
    };

    await this.store.save(checkpoint);
    this.emit('checkpointSaved', checkpoint);
    return checkpoint;
  }

  /**
   * Retrieve a checkpoint by ID
   */
  public async getCheckpoint(checkpointId: string): Promise<WorkflowCheckpoint | null> {
    return this.store.get(checkpointId);
  }

  /**
   * List checkpoints for a workflow or all checkpoints
   */
  public async listCheckpoints(workflowId?: string): Promise<WorkflowCheckpoint[]> {
    return this.store.list(workflowId);
  }

  /**
   * Get the most recent checkpoint for a workflow
   */
  public async getLatestCheckpoint(workflowId: string): Promise<WorkflowCheckpoint | null> {
    return this.store.getLatest(workflowId);
  }

  /**
   * Delete a checkpoint
   */
  public async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    return this.store.delete(checkpointId);
  }

  /**
   * Clear all checkpoints
   */
  public async clearCheckpoints(workflowId?: string): Promise<void> {
    return this.store.clear(workflowId);
  }
}
