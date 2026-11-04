/**
 * Workflow Scheduler
 * Manages workflow queues, concurrency limits, and scheduled execution
 */

import { EventEmitter } from 'node:events';
import {
  WorkflowPlan,
  WorkflowResult,
  WorkflowContext,
  WorkflowState,
} from '../types/workflow.js';
import { WorkflowOrchestrator } from './WorkflowOrchestrator.js';

export interface SchedulerOptions {
  maxConcurrentWorkflows?: number;
  defaultWorkflowTimeoutMs?: number;
}

export interface QueuedWorkflow {
  id: string;
  definition: WorkflowPlan;
  context: WorkflowContext;
  orchestrator: WorkflowOrchestrator;
  status: 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'ABORTED';
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: WorkflowResult;
  promise: Promise<WorkflowResult>;
  resolve: (res: WorkflowResult) => void;
  reject: (err: unknown) => void;
}

export class WorkflowScheduler extends EventEmitter {
  private queue: QueuedWorkflow[] = [];
  private runningWorkflows: Map<string, QueuedWorkflow> = new Map();
  private completedWorkflows: Map<string, QueuedWorkflow> = new Map();
  private maxConcurrent: number;
  private defaultTimeoutMs: number;

  constructor(options?: SchedulerOptions) {
    super();
    this.maxConcurrent = options?.maxConcurrentWorkflows ?? 5;
    this.defaultTimeoutMs = options?.defaultWorkflowTimeoutMs ?? 60000;
  }

  /**
   * Enqueue a workflow for managed execution
   */
  public enqueue(
    definition: WorkflowPlan,
    context: WorkflowContext,
    orchestrator: WorkflowOrchestrator
  ): Promise<WorkflowResult> {
    let resolveFn!: (res: WorkflowResult) => void;
    let rejectFn!: (err: unknown) => void;

    const promise = new Promise<WorkflowResult>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });

    const queuedItem: QueuedWorkflow = {
      id: context.workflowId,
      definition,
      context,
      orchestrator,
      status: 'QUEUED',
      enqueuedAt: Date.now(),
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    };

    this.queue.push(queuedItem);
    this.emit('workflowQueued', { workflowId: context.workflowId, queueLength: this.queue.length });

    // Try processing next
    void this.processNext();

    return promise;
  }

  /**
   * Check queue and launch workflows up to max concurrency
   */
  private async processNext(): Promise<void> {
    if (this.runningWorkflows.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    item.status = 'RUNNING';
    item.startedAt = Date.now();
    this.runningWorkflows.set(item.id, item);

    this.emit('workflowStarted', {
      workflowId: item.id,
      runningCount: this.runningWorkflows.size,
      remainingQueue: this.queue.length,
    });

    // Run with timeout wrapper
    const timeoutMs = item.definition.defaultTimeoutMs ?? this.defaultTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Workflow '${item.id}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        item.orchestrator.executeWorkflow(item.definition, item.context),
        timeoutPromise,
      ]);

      item.status = result.success ? 'COMPLETED' : 'FAILED';
      item.completedAt = Date.now();
      item.result = result;

      this.runningWorkflows.delete(item.id);
      this.completedWorkflows.set(item.id, item);

      this.emit('workflowFinished', { workflowId: item.id, success: result.success, result });
      item.resolve(result);
    } catch (err) {
      item.status = 'FAILED';
      item.completedAt = Date.now();

      this.runningWorkflows.delete(item.id);
      this.completedWorkflows.set(item.id, item);

      const errorResult: WorkflowResult = {
        workflowId: item.id,
        finalState: WorkflowState.FAILED,
        success: false,
        startTime: item.startedAt ?? Date.now(),
        endTime: Date.now(),
        durationMs: Date.now() - (item.startedAt ?? Date.now()),
        executedSteps: [],
        outputs: {},
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'SCHEDULER_EXECUTION_ERROR',
        },
        context: item.context,
      };

      this.emit('workflowError', { workflowId: item.id, error: err });
      item.resolve(errorResult);
    } finally {
      // Trigger next queued workflow
      void this.processNext();
    }
  }

  public getWorkflowStatus(workflowId: string): QueuedWorkflow | undefined {
    return (
      this.runningWorkflows.get(workflowId) ??
      this.queue.find((w) => w.id === workflowId) ??
      this.completedWorkflows.get(workflowId)
    );
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getRunningCount(): number {
    return this.runningWorkflows.size;
  }

  public async pauseWorkflow(workflowId: string): Promise<void> {
    const running = this.runningWorkflows.get(workflowId);
    if (!running) {
      throw new Error(`Workflow '${workflowId}' is not currently running`);
    }
    await running.orchestrator.getStateMachine().pause();
    running.status = 'PAUSED';
    this.emit('workflowPaused', { workflowId });
  }

  public async resumeWorkflow(workflowId: string): Promise<void> {
    const running = this.runningWorkflows.get(workflowId);
    if (!running) {
      throw new Error(`Workflow '${workflowId}' is not currently tracked`);
    }
    await running.orchestrator.getStateMachine().resume();
    running.status = 'RUNNING';
    this.emit('workflowResumed', { workflowId });
  }

  public async abortWorkflow(workflowId: string, reason?: string): Promise<void> {
    const running = this.runningWorkflows.get(workflowId);
    if (running) {
      await running.orchestrator.getStateMachine().abort(reason);
      running.status = 'ABORTED';
      this.runningWorkflows.delete(workflowId);
      this.completedWorkflows.set(workflowId, running);
      this.emit('workflowAborted', { workflowId, reason });
      void this.processNext();
      return;
    }

    const queueIdx = this.queue.findIndex((w) => w.id === workflowId);
    if (queueIdx >= 0) {
      const removed = this.queue.splice(queueIdx, 1)[0]!;
      removed.status = 'ABORTED';
      this.completedWorkflows.set(workflowId, removed);
      this.emit('workflowAborted', { workflowId, reason });
    }
  }
}
