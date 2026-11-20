/**
 * State Machine Transition Table
 * Enforces valid transition paths across the agentic lifecycle
 */

import { WorkflowState } from '../types/workflow.js';
import { WorkflowEvent, StateTransitionRule } from '../types/state-machine.js';

export class TransitionTable {
  private rules: StateTransitionRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Defines standard valid transitions for Academia AI Voice Co-Pilot
   */
  private initializeDefaultRules(): void {
    // Starting workflow
    this.addRule(WorkflowState.IDLE, WorkflowState.INITIALIZING, WorkflowEvent.START, 'Workflow initiated');

    // From INITIALIZING
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.OBSERVING, WorkflowEvent.OBSERVE, 'Capture visual/app context');
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.REASONING, WorkflowEvent.REASON, 'Direct reasoning on voice query');
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.PLANNING, WorkflowEvent.PLAN, 'Decompose multi-step task');
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Direct tool execution from initialization');
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Initial tool step requires approval');
    this.addRule(WorkflowState.INITIALIZING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Initialization error');

    // From OBSERVING (Context gathering: screen, OCR, active window)
    this.addRule(WorkflowState.OBSERVING, WorkflowState.REASONING, WorkflowEvent.OBSERVE_DONE, 'Context collection finished');
    this.addRule(WorkflowState.OBSERVING, WorkflowState.REASONING, WorkflowEvent.REASON, 'Direct transition to reasoning');
    this.addRule(WorkflowState.OBSERVING, WorkflowState.RECOVERING, WorkflowEvent.RECOVER, 'Context capture failed, entering recovery');
    this.addRule(WorkflowState.OBSERVING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Context capture failed completely');

    // From REASONING (Multimodal LLM / prompt evaluation)
    this.addRule(WorkflowState.REASONING, WorkflowState.PLANNING, WorkflowEvent.PLAN, 'Plan decomposition needed');
    this.addRule(WorkflowState.REASONING, WorkflowState.PLANNING, WorkflowEvent.REASON_DONE, 'Reasoning done, proceed to planning');
    this.addRule(WorkflowState.REASONING, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Sensitive tool execution proposed');
    this.addRule(WorkflowState.REASONING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Direct tool execution allowed');
    this.addRule(WorkflowState.REASONING, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'Answer ready without tools');
    this.addRule(WorkflowState.REASONING, WorkflowState.RECOVERING, WorkflowEvent.RECOVER, 'Reasoning error recovery');
    this.addRule(WorkflowState.REASONING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Reasoning failure');

    // From PLANNING (Step decomposition)
    this.addRule(WorkflowState.PLANNING, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Planned step requires human sign-off');
    this.addRule(WorkflowState.PLANNING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Execute planned step');
    this.addRule(WorkflowState.PLANNING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.PLAN_DONE, 'Planning complete, execute first step');
    this.addRule(WorkflowState.PLANNING, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'No tool steps needed, respond');
    this.addRule(WorkflowState.PLANNING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Planning failed');

    // From AWAITING_APPROVAL (Human-in-the-loop safety gate)
    this.addRule(WorkflowState.AWAITING_APPROVAL, WorkflowState.EXECUTING_TOOL, WorkflowEvent.APPROVE, 'User approved sensitive action');
    this.addRule(WorkflowState.AWAITING_APPROVAL, WorkflowState.RECOVERING, WorkflowEvent.REJECT, 'User rejected action, seeking fallback');
    this.addRule(WorkflowState.AWAITING_APPROVAL, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'User rejected or cancelled, formulate response');
    this.addRule(WorkflowState.AWAITING_APPROVAL, WorkflowState.ABORTED, WorkflowEvent.ABORT, 'User aborted workflow');

    // From EXECUTING_TOOL (Mock / real tool invocation)
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.VERIFYING, WorkflowEvent.TOOL_SUCCESS, 'Tool executed successfully');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.VERIFYING, WorkflowEvent.VERIFY, 'Verify tool result');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Direct transition between tool executions');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Subsequent tool execution requires approval');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'Move to responding after tools');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.COMPLETED, WorkflowEvent.COMPLETE, 'Workflow completed after tools');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.RECOVERING, WorkflowEvent.TOOL_FAILURE, 'Tool execution error, entering recovery');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.RECOVERING, WorkflowEvent.RECOVER, 'Direct trigger of recovery');
    this.addRule(WorkflowState.EXECUTING_TOOL, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Unrecoverable tool failure');

    // From VERIFYING (Output assertions and schema checks)
    this.addRule(WorkflowState.VERIFYING, WorkflowState.PLANNING, WorkflowEvent.PLAN, 'Proceed to next planned step');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Next step requires approval');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Proceed directly to next tool');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.RESPONDING, WorkflowEvent.VERIFY_SUCCESS, 'Verification succeeded, generate final response');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'Direct response after verify');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.RECOVERING, WorkflowEvent.VERIFY_FAILURE, 'Verification failed, retry or compensate');
    this.addRule(WorkflowState.VERIFYING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Verification unrecoverable failure');

    // From RECOVERING (Retries, fallback steps, compensation)
    this.addRule(WorkflowState.RECOVERING, WorkflowState.EXECUTING_TOOL, WorkflowEvent.EXECUTE_TOOL, 'Retry tool execution');
    this.addRule(WorkflowState.RECOVERING, WorkflowState.PLANNING, WorkflowEvent.PLAN, 'Fallback to alternate step');
    this.addRule(WorkflowState.RECOVERING, WorkflowState.AWAITING_APPROVAL, WorkflowEvent.REQUIRE_APPROVAL, 'Fallback requires approval');
    this.addRule(WorkflowState.RECOVERING, WorkflowState.RESPONDING, WorkflowEvent.RESPOND, 'Graceful degradation / clarification to user');
    this.addRule(WorkflowState.RECOVERING, WorkflowState.COMPLETED, WorkflowEvent.COMPLETE, 'Recovery completed, mark workflow complete');
    this.addRule(WorkflowState.RECOVERING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Recovery attempts exhausted');

    // From RESPONDING (Formulating voice / text response)
    this.addRule(WorkflowState.RESPONDING, WorkflowState.COMPLETED, WorkflowEvent.RESPOND_DONE, 'Response delivered, workflow done');
    this.addRule(WorkflowState.RESPONDING, WorkflowState.COMPLETED, WorkflowEvent.COMPLETE, 'Workflow completed');
    this.addRule(WorkflowState.RESPONDING, WorkflowState.FAILED, WorkflowEvent.FAIL, 'Response generation failed');

    // Global Pause, Resume, Abort handling
    const pauseableStates = [
      WorkflowState.INITIALIZING,
      WorkflowState.OBSERVING,
      WorkflowState.REASONING,
      WorkflowState.PLANNING,
      WorkflowState.AWAITING_APPROVAL,
      WorkflowState.EXECUTING_TOOL,
      WorkflowState.VERIFYING,
      WorkflowState.RECOVERING,
      WorkflowState.RESPONDING,
    ];

    for (const state of pauseableStates) {
      this.addRule(state, WorkflowState.PAUSED, WorkflowEvent.PAUSE, `Pause from ${state}`);
      this.addRule(state, WorkflowState.ABORTED, WorkflowEvent.ABORT, `Abort from ${state}`);
    }

    // Resume from PAUSED back to active states
    for (const state of pauseableStates) {
      this.addRule(WorkflowState.PAUSED, state, WorkflowEvent.RESUME, `Resume back to ${state}`);
    }
    this.addRule(WorkflowState.PAUSED, WorkflowState.ABORTED, WorkflowEvent.ABORT, 'Abort paused workflow');

    // Terminal states can be reset to IDLE
    this.addRule(WorkflowState.COMPLETED, WorkflowState.IDLE, WorkflowEvent.RESET, 'Reset workflow to IDLE');
    this.addRule(WorkflowState.FAILED, WorkflowState.IDLE, WorkflowEvent.RESET, 'Reset workflow to IDLE');
    this.addRule(WorkflowState.ABORTED, WorkflowState.IDLE, WorkflowEvent.RESET, 'Reset workflow to IDLE');
  }

  public addRule(
    from: WorkflowState,
    to: WorkflowState,
    event: WorkflowEvent,
    description?: string,
    guard?: StateTransitionRule['guard'],
    action?: StateTransitionRule['action']
  ): void {
    const existingIdx = this.rules.findIndex((r) => r.from === from && r.to === to && r.event === event);
    if (existingIdx >= 0) {
      this.rules[existingIdx] = { from, to, event, description, guard, action };
    } else {
      this.rules.unshift({ from, to, event, description, guard, action });
    }
  }

  public findRule(from: WorkflowState, event: WorkflowEvent, targetState?: WorkflowState): StateTransitionRule | undefined {
    if (targetState) {
      return this.rules.find((r) => r.from === from && r.to === targetState && r.event === event);
    }
    return this.rules.find((r) => r.from === from && r.event === event);
  }

  public isValidTransition(from: WorkflowState, to: WorkflowState, event: WorkflowEvent): boolean {
    return this.rules.some((r) => r.from === from && r.to === to && r.event === event);
  }

  public getAllowedTransitions(from: WorkflowState): StateTransitionRule[] {
    return this.rules.filter((r) => r.from === from);
  }

  public isTerminalState(state: WorkflowState): boolean {
    return (
      state === WorkflowState.COMPLETED ||
      state === WorkflowState.FAILED ||
      state === WorkflowState.ABORTED
    );
  }

  public getRules(): readonly StateTransitionRule[] {
    return this.rules;
  }
}
