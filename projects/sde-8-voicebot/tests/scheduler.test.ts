import { describe, it, expect } from 'vitest';
import { WorkflowScheduler } from '../src/scheduler/WorkflowScheduler.js';
import { WorkflowOrchestrator } from '../src/scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../src/tools/MockToolExecutor.js';
import { WorkflowBuilder } from '../src/workflows/WorkflowBuilder.js';
import { WorkflowContext, WorkflowState } from '../src/types/workflow.js';
import { RiskLevel } from '../src/types/safety.js';

function createDummyContext(id: string): WorkflowContext {
  return {
    workflowId: id,
    name: 'Scheduled Job',
    userRequest: {
      requestId: `req_${id}`,
      sessionId: 'sess_sched',
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

describe('WorkflowScheduler', () => {
  it('should process queued workflows respecting concurrency limits', async () => {
    const executor = new MockToolExecutor();
    // Simulate slight delay on execution
    executor.configureMock('summarize_text', {
      simulatedLatencyMs: 30,
    });

    const scheduler = new WorkflowScheduler({ maxConcurrentWorkflows: 2 });
    const def = new WorkflowBuilder('wf_simple', 'Simple Job')
      .addToolStep('s1', 'Summarize', 'summarize_text', { text: 'Hello' }, { riskLevel: RiskLevel.A_INFORMATIONAL })
      .build();

    const orch1 = new WorkflowOrchestrator(executor);
    const orch2 = new WorkflowOrchestrator(executor);
    const orch3 = new WorkflowOrchestrator(executor);

    const p1 = scheduler.enqueue(def, createDummyContext('job_1'), orch1);
    const p2 = scheduler.enqueue(def, createDummyContext('job_2'), orch2);
    const p3 = scheduler.enqueue(def, createDummyContext('job_3'), orch3);

    // Initial check: running <= 2, queued >= 1
    expect(scheduler.getRunningCount()).toBeLessThanOrEqual(2);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);
    expect(scheduler.getQueueLength()).toBe(0);
    expect(scheduler.getRunningCount()).toBe(0);
  });

  it('should handle workflow execution timeout', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', {
      simulatedLatencyMs: 250,
    });

    const scheduler = new WorkflowScheduler({ defaultWorkflowTimeoutMs: 50 });
    const def = new WorkflowBuilder('wf_slow', 'Slow Job')
      .addToolStep('s1', 'Summarize', 'summarize_text', { text: 'Content' })
      .build();

    const orch = new WorkflowOrchestrator(executor);
    const result = await scheduler.enqueue(def, createDummyContext('slow_job'), orch);

    expect(result.success).toBe(false);
    expect(result.finalState).toBe(WorkflowState.FAILED);
    expect(result.error?.message).toContain('timed out');
  });

  it('should abort running workflow on request', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', {
      simulatedLatencyMs: 300,
    });

    const scheduler = new WorkflowScheduler();
    const def = new WorkflowBuilder('wf_to_abort', 'Abort Job')
      .addToolStep('s1', 'Summarize', 'summarize_text', { text: 'Hello' })
      .build();

    const orch = new WorkflowOrchestrator(executor);
    const promise = scheduler.enqueue(def, createDummyContext('abort_job'), orch);

    // Give it a moment to enter running state
    await new Promise((r) => setTimeout(r, 20));

    await scheduler.abortWorkflow('abort_job', 'User clicked cancel');

    const status = scheduler.getWorkflowStatus('abort_job');
    expect(status?.status).toBe('ABORTED');
  });

  it('should abort a queued workflow before it starts', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', { simulatedLatencyMs: 200 });

    const scheduler = new WorkflowScheduler({ maxConcurrentWorkflows: 1 });
    const def = new WorkflowBuilder('wf_job', 'Job')
      .addToolStep('s1', 'Summarize', 'summarize_text', { text: 'Hello' })
      .build();

    const orch1 = new WorkflowOrchestrator(executor);
    const orch2 = new WorkflowOrchestrator(executor);

    // Job 1 runs, Job 2 stays queued
    scheduler.enqueue(def, createDummyContext('job_active'), orch1);
    scheduler.enqueue(def, createDummyContext('job_queued'), orch2);

    expect(scheduler.getQueueLength()).toBe(1);

    await scheduler.abortWorkflow('job_queued', 'Cancelled while in queue');
    expect(scheduler.getQueueLength()).toBe(0);
    const status = scheduler.getWorkflowStatus('job_queued');
    expect(status?.status).toBe('ABORTED');
  });

  it('should support pausing and resuming a running workflow via scheduler', async () => {
    const executor = new MockToolExecutor();
    executor.configureMock('summarize_text', { simulatedLatencyMs: 150 });

    const scheduler = new WorkflowScheduler();
    const def = new WorkflowBuilder('wf_pause_job', 'Pausable')
      .addToolStep('s1', 'Summarize', 'summarize_text', { text: 'Hello' })
      .build();

    const orch = new WorkflowOrchestrator(executor);
    scheduler.enqueue(def, createDummyContext('pause_run'), orch);

    await new Promise((r) => setTimeout(r, 20));

    await scheduler.pauseWorkflow('pause_run');
    expect(scheduler.getWorkflowStatus('pause_run')?.status).toBe('PAUSED');

    await scheduler.resumeWorkflow('pause_run');
    expect(scheduler.getWorkflowStatus('pause_run')?.status).toBe('RUNNING');
  });

  it('should throw error when pausing or resuming untracked workflow', async () => {
    const scheduler = new WorkflowScheduler();
    await expect(scheduler.pauseWorkflow('ghost_id')).rejects.toThrow();
    await expect(scheduler.resumeWorkflow('ghost_id')).rejects.toThrow();
  });
});
