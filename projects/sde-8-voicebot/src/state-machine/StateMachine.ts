/**
 * Agentic State Machine
 * Orchestrates discrete decision steps and workflow state transitions
 */

import { EventEmitter } from 'node:events';
import { WorkflowState, WorkflowContext } from '../types/workflow.js';
import {
  WorkflowEvent,
  StateMachineSnapshot,
  StateHook,
  TransitionHook,
  StateTransitionRule,
} from '../types/state-machine.js';
import { TransitionTable } from './TransitionTable.js';

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromState: WorkflowState,
    public readonly event: WorkflowEvent,
    public readonly allowedEvents: WorkflowEvent[]
  ) {
    super(
      `Invalid transition: Cannot process event '${event}' from state '${fromState}'. Allowed events: [${allowedEvents.join(', ')}]`
    );
    this.name = 'InvalidTransitionError';
  }
}

export class TransitionGuardError extends Error {
  constructor(
    public readonly fromState: WorkflowState,
    public readonly toState: WorkflowState,
    public readonly event: WorkflowEvent,
    public readonly reason: string
  ) {
    super(
      `Transition guard rejected: Event '${event}' from '${fromState}' to '${toState}'. Reason: ${reason}`
    );
    this.name = 'TransitionGuardError';
  }
}

export class StateMachine extends EventEmitter {
  private currentState: WorkflowState;
  private previousState?: WorkflowState;
  private transitionTable: TransitionTable;
  private context: WorkflowContext;
  private sequenceCounter = 0;
  private history: StateMachineSnapshot[] = [];
  private pausedPreviousState?: WorkflowState;

  private onEnterHooks: Map<WorkflowState, StateHook[]> = new Map();
  private onExitHooks: Map<WorkflowState, StateHook[]> = new Map();
  private beforeTransitionHooks: TransitionHook[] = [];
  private afterTransitionHooks: TransitionHook[] = [];

  constructor(context: WorkflowContext, initialState = WorkflowState.IDLE, table?: TransitionTable) {
    super();
    this.context = context;
    this.currentState = initialState;
    this.transitionTable = table ?? new TransitionTable();
    this.recordSnapshot(undefined);
  }

  public getState(): WorkflowState {
    return this.currentState;
  }

  public getPreviousState(): WorkflowState | undefined {
    return this.previousState;
  }

  public getContext(): WorkflowContext {
    return this.context;
  }

  public updateContext(updater: (ctx: WorkflowContext) => void): void {
    updater(this.context);
  }

  public canTransition(event: WorkflowEvent): boolean {
    const rule = this.transitionTable.findRule(this.currentState, event);
    return rule !== undefined;
  }

  public getAllowedEvents(): WorkflowEvent[] {
    return this.transitionTable
      .getAllowedTransitions(this.currentState)
      .map((r) => r.event);
  }

  /**
   * Process a state machine event and execute the corresponding transition
   */
  public async transition(event: WorkflowEvent, payload?: unknown): Promise<WorkflowState> {
    const targetState = typeof payload === 'object' && payload !== null && 'targetState' in payload
      ? (payload as { targetState?: WorkflowState }).targetState
      : undefined;
    const rule = this.transitionTable.findRule(this.currentState, event, targetState);

    if (!rule) {
      const allowed = this.getAllowedEvents();
      const err = new InvalidTransitionError(this.currentState, event, allowed);
      this.emit('error', err);
      throw err;
    }

    // Evaluate Guard if present
    if (rule.guard) {
      try {
        const allowed = await Promise.resolve(rule.guard(this.context, payload));
        if (!allowed) {
          const guardErr = new TransitionGuardError(
            this.currentState,
            rule.to,
            event,
            'Condition not met'
          );
          this.emit('error', guardErr);
          throw guardErr;
        }
      } catch (err) {
        if (err instanceof TransitionGuardError) throw err;
        const wrapped = new TransitionGuardError(
          this.currentState,
          rule.to,
          event,
          err instanceof Error ? err.message : String(err)
        );
        this.emit('error', wrapped);
        throw wrapped;
      }
    }

    const fromState = this.currentState;
    const toState = rule.to;

    // Track paused state return target
    if (toState === WorkflowState.PAUSED) {
      this.pausedPreviousState = fromState;
    }

    // Before Transition Hooks
    for (const hook of this.beforeTransitionHooks) {
      await Promise.resolve(hook(fromState, toState, event, this.context, payload));
    }

    // Exit Hooks for current state
    const exitHooks = this.onExitHooks.get(fromState) ?? [];
    for (const hook of exitHooks) {
      await Promise.resolve(hook(fromState, this.context, event));
    }

    // Apply rule action
    if (rule.action) {
      await Promise.resolve(rule.action(this.context, payload));
    }

    // Update state
    this.previousState = fromState;
    this.currentState = toState;
    this.recordSnapshot(event);

    // Enter Hooks for new state
    const enterHooks = this.onEnterHooks.get(toState) ?? [];
    for (const hook of enterHooks) {
      await Promise.resolve(hook(toState, this.context, event));
    }

    // After Transition Hooks
    for (const hook of this.afterTransitionHooks) {
      await Promise.resolve(hook(fromState, toState, event, this.context, payload));
    }

    this.emit('transition', {
      from: fromState,
      to: toState,
      event,
      payload,
      context: this.context,
    });
    this.emit('stateChanged', toState, fromState);

    return this.currentState;
  }

  /**
   * Pause execution
   */
  public async pause(): Promise<void> {
    if (this.currentState === WorkflowState.PAUSED) return;
    await this.transition(WorkflowEvent.PAUSE);
  }

  /**
   * Resume execution from paused state
   */
  public async resume(): Promise<void> {
    if (this.currentState !== WorkflowState.PAUSED) {
      throw new Error(`Cannot resume workflow that is not paused (current state: ${this.currentState})`);
    }
    const targetState = this.pausedPreviousState ?? WorkflowState.INITIALIZING;
    const rule: StateTransitionRule = {
      from: WorkflowState.PAUSED,
      to: targetState,
      event: WorkflowEvent.RESUME,
    };
    this.transitionTable.addRule(rule.from, rule.to, rule.event);
    await this.transition(WorkflowEvent.RESUME, { targetState });
  }

  /**
   * Abort workflow execution
   */
  public async abort(reason?: string): Promise<void> {
    if (this.transitionTable.isTerminalState(this.currentState)) return;
    this.context.logs.push({
      timestamp: Date.now(),
      level: 'WARN',
      message: `Workflow aborted: ${reason ?? 'User requested abort'}`,
    });
    await this.transition(WorkflowEvent.ABORT, { reason });
  }

  /**
   * Reset workflow back to IDLE
   */
  public async reset(): Promise<void> {
    if (!this.transitionTable.isTerminalState(this.currentState)) {
      throw new Error(`Cannot reset non-terminal workflow (current state: ${this.currentState})`);
    }
    await this.transition(WorkflowEvent.RESET);
  }

  public onEnter(state: WorkflowState, hook: StateHook): this {
    const list = this.onEnterHooks.get(state) ?? [];
    list.push(hook);
    this.onEnterHooks.set(state, list);
    return this;
  }

  public onExit(state: WorkflowState, hook: StateHook): this {
    const list = this.onExitHooks.get(state) ?? [];
    list.push(hook);
    this.onExitHooks.set(state, list);
    return this;
  }

  public beforeTransition(hook: TransitionHook): this {
    this.beforeTransitionHooks.push(hook);
    return this;
  }

  public afterTransition(hook: TransitionHook): this {
    this.afterTransitionHooks.push(hook);
    return this;
  }

  private recordSnapshot(lastEvent?: WorkflowEvent): void {
    this.sequenceCounter++;
    const snapshot: StateMachineSnapshot = {
      workflowId: this.context.workflowId,
      currentState: this.currentState,
      previousState: this.previousState,
      lastEvent,
      sequence: this.sequenceCounter,
      timestamp: Date.now(),
      contextSnapshot: JSON.parse(JSON.stringify(this.context.stepResults)),
    };
    this.history.push(snapshot);
  }

  public getHistory(): readonly StateMachineSnapshot[] {
    return this.history;
  }

  public isTerminal(): boolean {
    return this.transitionTable.isTerminalState(this.currentState);
  }
}
