/**
 * State Machine Types & Transition Event Definitions
 * SDE-8 Agentic Workflow Orchestration
 */

import { WorkflowState, WorkflowContext } from './workflow.js';

/**
 * Events that trigger transitions between workflow states
 */
export enum WorkflowEvent {
  START = 'START',
  OBSERVE = 'OBSERVE',
  OBSERVE_DONE = 'OBSERVE_DONE',
  REASON = 'REASON',
  REASON_DONE = 'REASON_DONE',
  PLAN = 'PLAN',
  PLAN_DONE = 'PLAN_DONE',
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  EXECUTE_TOOL = 'EXECUTE_TOOL',
  TOOL_SUCCESS = 'TOOL_SUCCESS',
  TOOL_FAILURE = 'TOOL_FAILURE',
  VERIFY = 'VERIFY',
  VERIFY_SUCCESS = 'VERIFY_SUCCESS',
  VERIFY_FAILURE = 'VERIFY_FAILURE',
  RESPOND = 'RESPOND',
  RESPOND_DONE = 'RESPOND_DONE',
  COMPLETE = 'COMPLETE',
  FAIL = 'FAIL',
  RECOVER = 'RECOVER',
  RECOVERED = 'RECOVERED',
  PAUSE = 'PAUSE',
  RESUME = 'RESUME',
  ABORT = 'ABORT',
  RESET = 'RESET',
}

/**
 * Guard predicate function that determines whether a transition is allowed
 */
export type TransitionGuard = (context: WorkflowContext, eventPayload?: unknown) => boolean | Promise<boolean>;

/**
 * Transition rule in the state transition table
 */
export interface StateTransitionRule {
  from: WorkflowState;
  to: WorkflowState;
  event: WorkflowEvent;
  guard?: TransitionGuard;
  action?: (context: WorkflowContext, eventPayload?: unknown) => void | Promise<void>;
  description?: string;
}

/**
 * Snapshot of the state machine at a single point in time
 */
export interface StateMachineSnapshot {
  workflowId: string;
  currentState: WorkflowState;
  previousState?: WorkflowState;
  lastEvent?: WorkflowEvent;
  sequence: number;
  timestamp: number;
  contextSnapshot: Record<string, unknown>;
}

/**
 * Lifecycle hook callbacks
 */
export type StateHook = (state: WorkflowState, context: WorkflowContext, event?: WorkflowEvent) => void | Promise<void>;
export type TransitionHook = (
  from: WorkflowState,
  to: WorkflowState,
  event: WorkflowEvent,
  context: WorkflowContext,
  payload?: unknown
) => void | Promise<void>;
