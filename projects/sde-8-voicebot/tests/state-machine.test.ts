import { describe, it, expect, vi } from 'vitest';
import { StateMachine, InvalidTransitionError, TransitionGuardError } from '../src/state-machine/StateMachine.js';
import { TransitionTable } from '../src/state-machine/TransitionTable.js';
import { WorkflowState, WorkflowContext } from '../src/types/workflow.js';
import { WorkflowEvent } from '../src/types/state-machine.js';

function createMockContext(workflowId = 'wf_test_01'): WorkflowContext {
  return {
    workflowId,
    name: 'Test Workflow',
    userRequest: {
      requestId: 'req_01',
      sessionId: 'sess_01',
      rawVoiceInput: 'Find document',
      intent: 'file_search',
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'VS Code',
      visibleContent: 'Editor buffer',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

describe('StateMachine Core', () => {
  it('should initialize with IDLE state and snapshot history', () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx);

    expect(sm.getState()).toBe(WorkflowState.IDLE);
    expect(sm.getHistory().length).toBe(1);
    expect(sm.getHistory()[0]!.currentState).toBe(WorkflowState.IDLE);
    expect(sm.isTerminal()).toBe(false);
  });

  it('should handle standard happy-path agentic transitions', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx);

    await sm.transition(WorkflowEvent.START);
    expect(sm.getState()).toBe(WorkflowState.INITIALIZING);

    await sm.transition(WorkflowEvent.OBSERVE);
    expect(sm.getState()).toBe(WorkflowState.OBSERVING);

    await sm.transition(WorkflowEvent.OBSERVE_DONE);
    expect(sm.getState()).toBe(WorkflowState.REASONING);

    await sm.transition(WorkflowEvent.PLAN);
    expect(sm.getState()).toBe(WorkflowState.PLANNING);

    await sm.transition(WorkflowEvent.EXECUTE_TOOL);
    expect(sm.getState()).toBe(WorkflowState.EXECUTING_TOOL);

    await sm.transition(WorkflowEvent.TOOL_SUCCESS);
    expect(sm.getState()).toBe(WorkflowState.VERIFYING);

    await sm.transition(WorkflowEvent.VERIFY_SUCCESS);
    expect(sm.getState()).toBe(WorkflowState.RESPONDING);

    await sm.transition(WorkflowEvent.RESPOND_DONE);
    expect(sm.getState()).toBe(WorkflowState.COMPLETED);
    expect(sm.isTerminal()).toBe(true);
  });

  it('should reject invalid transitions and throw InvalidTransitionError', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx);

    // Cannot jump directly from IDLE to EXECUTING_TOOL
    await expect(sm.transition(WorkflowEvent.EXECUTE_TOOL)).rejects.toThrow(InvalidTransitionError);

    try {
      await sm.transition(WorkflowEvent.EXECUTE_TOOL);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const invalidErr = err as InvalidTransitionError;
      expect(invalidErr.fromState).toBe(WorkflowState.IDLE);
      expect(invalidErr.event).toBe(WorkflowEvent.EXECUTE_TOOL);
      expect(invalidErr.allowedEvents).toContain(WorkflowEvent.START);
    }
  });

  it('should evaluate transition guards and enforce conditions', async () => {
    const ctx = createMockContext();
    const table = new TransitionTable();

    // Add a guarded rule
    table.addRule(
      WorkflowState.INITIALIZING,
      WorkflowState.REASONING,
      WorkflowEvent.REASON,
      'Guarded rule',
      (c) => c.variables.authenticated === true
    );

    const sm = new StateMachine(ctx, WorkflowState.INITIALIZING, table);

    // Guard should fail because authenticated is undefined
    await expect(sm.transition(WorkflowEvent.REASON)).rejects.toThrow(TransitionGuardError);

    // Set variable and retry
    sm.updateContext((c) => {
      c.variables.authenticated = true;
    });

    const newState = await sm.transition(WorkflowEvent.REASON);
    expect(newState).toBe(WorkflowState.REASONING);
  });

  it('should execute lifecycle hooks in correct order', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx);
    const trace: string[] = [];

    sm.beforeTransition((from, to, event) => {
      trace.push(`before:${from}->${to}:${event}`);
    });

    sm.onExit(WorkflowState.IDLE, () => {
      trace.push('exit:IDLE');
    });

    sm.onEnter(WorkflowState.INITIALIZING, () => {
      trace.push('enter:INITIALIZING');
    });

    sm.afterTransition((from, to) => {
      trace.push(`after:${from}->${to}`);
    });

    await sm.transition(WorkflowEvent.START);

    expect(trace).toEqual([
      'before:IDLE->INITIALIZING:START',
      'exit:IDLE',
      'enter:INITIALIZING',
      'after:IDLE->INITIALIZING',
    ]);
  });

  it('should support pause and resume lifecycle', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx, WorkflowState.PLANNING);

    await sm.pause();
    expect(sm.getState()).toBe(WorkflowState.PAUSED);

    await sm.resume();
    expect(sm.getState()).toBe(WorkflowState.PLANNING);
  });

  it('should support workflow abort and reset', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx, WorkflowState.EXECUTING_TOOL);

    await sm.abort('User cancellation');
    expect(sm.getState()).toBe(WorkflowState.ABORTED);
    expect(sm.isTerminal()).toBe(true);

    await sm.reset();
    expect(sm.getState()).toBe(WorkflowState.IDLE);
  });

  it('should record snapshots on every transition', async () => {
    const ctx = createMockContext();
    const sm = new StateMachine(ctx);

    await sm.transition(WorkflowEvent.START);
    await sm.transition(WorkflowEvent.OBSERVE);
    await sm.transition(WorkflowEvent.OBSERVE_DONE);

    const history = sm.getHistory();
    expect(history.length).toBe(4); // IDLE, INITIALIZING, OBSERVING, REASONING
    expect(history[history.length - 1]!.currentState).toBe(WorkflowState.REASONING);
    expect(history[history.length - 1]!.lastEvent).toBe(WorkflowEvent.OBSERVE_DONE);
  });
});
