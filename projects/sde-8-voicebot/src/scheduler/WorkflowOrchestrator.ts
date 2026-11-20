/**
 * Workflow Orchestrator
 * Coordinates multi-step reasoning workflows across StateMachine, SafetyGate, ToolExecutor,
 * PlanValidator, ErrorRecoveryEngine, CheckpointManager, IdempotencyManager, and AuditTrail.
 * Implements Week 1–3: Agentic state machine, safety gate, allow-list, timeouts, bounded retries,
 * checkpoint/resume, step-level audit trail, progress events, and idempotency keys.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { EventEmitter } from 'node:events';
import {
  WorkflowPlan,
  WorkflowStep,
  WorkflowTransition,
  WorkflowContext,
  WorkflowState,
  StepType,
  WorkflowResult,
} from '../types/workflow.js';
import { WorkflowEvent } from '../types/state-machine.js';
import { RiskLevel } from '../types/safety.js';
import { IToolExecutor, ToolExecutionRequest } from '../types/tool.js';
import { CompensationAction } from '../types/error-recovery.js';
import { StateMachine } from '../state-machine/StateMachine.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import { ErrorRecoveryEngine } from '../recovery/ErrorRecoveryEngine.js';
import { PlanValidator } from '../validation/PlanValidator.js';
import { ValidationOptions, PlanValidationResult } from '../types/validation.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { CheckpointManager } from '../checkpoint/CheckpointManager.js';
import { IdempotencyManager } from '../safety/IdempotencyManager.js';
import { AuditTrail } from '../audit/AuditTrail.js';
import { AuditEventType } from '../types/audit.js';
import { ProgressEvent } from '../types/progress.js';
import { ResumeOptions, CheckpointStatus } from '../types/checkpoint.js';

export interface ExecuteWorkflowOptions {
  validatePlan?: boolean;
  checkpointAfterEachStep?: boolean;
}

export class WorkflowOrchestrator extends EventEmitter {
  private stateMachine!: StateMachine;
  private safetyGate: SafetyGate;
  private toolExecutor: IToolExecutor;
  private recoveryEngine: ErrorRecoveryEngine;
  private planValidator: PlanValidator;
  private checkpointManager: CheckpointManager;
  private idempotencyManager: IdempotencyManager;
  private auditTrail: AuditTrail;
  private abortController: AbortController = new AbortController();
  private isCancelled = false;
  private pendingApprovalResolvers: Map<
    string,
    { resolve: (approved: boolean) => void; reject: (err: unknown) => void }
  > = new Map();
  private executedCompensations: CompensationAction[] = [];

  constructor(
    toolExecutor: IToolExecutor,
    safetyGate?: SafetyGate,
    recoveryEngine?: ErrorRecoveryEngine,
    planValidator?: PlanValidator,
    checkpointManager?: CheckpointManager,
    idempotencyManager?: IdempotencyManager,
    auditTrail?: AuditTrail
  ) {
    super();
    this.toolExecutor = toolExecutor;
    this.safetyGate = safetyGate ?? new SafetyGate();
    this.recoveryEngine = recoveryEngine ?? new ErrorRecoveryEngine();
    this.checkpointManager = checkpointManager ?? new CheckpointManager();
    this.idempotencyManager = idempotencyManager ?? new IdempotencyManager();
    this.auditTrail = auditTrail ?? new AuditTrail();

    const registry =
      'getRegistry' in toolExecutor
        ? (toolExecutor as MockToolExecutor).getRegistry()
        : undefined;

    this.planValidator = planValidator ?? new PlanValidator(registry);

    // Wire safety gate into mock tool executor if applicable
    if (this.toolExecutor instanceof MockToolExecutor) {
      this.toolExecutor.setSafetyGate(this.safetyGate);
    }
  }

  public getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  public getSafetyGate(): SafetyGate {
    return this.safetyGate;
  }

  public getToolExecutor(): IToolExecutor {
    return this.toolExecutor;
  }

  public getRecoveryEngine(): ErrorRecoveryEngine {
    return this.recoveryEngine;
  }

  public getPlanValidator(): PlanValidator {
    return this.planValidator;
  }

  public getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  public getIdempotencyManager(): IdempotencyManager {
    return this.idempotencyManager;
  }

  public getAuditTrail(): AuditTrail {
    return this.auditTrail;
  }

  /**
   * Validate a WorkflowPlan against dependencies, cycles, and allow-listed tools
   */
  public validatePlan(definition: WorkflowPlan, options?: ValidationOptions): PlanValidationResult {
    return this.planValidator.validate(definition, options);
  }

  public validatePlanOrThrow(definition: WorkflowPlan, options?: ValidationOptions): void {
    this.planValidator.validateOrThrow(definition, options);
  }

  /**
   * Cancel an in-flight workflow execution mid-flight
   */
  public cancel(reason = 'Execution cancelled by user'): void {
    this.isCancelled = true;
    this.abortController.abort(reason);
    this.emit('workflowCancelled', { reason });
  }

  /**
   * Submit human approval decision for an awaiting step
   */
  public submitApproval(stepId: string, approved: boolean, reason?: string): void {
    const resolver = this.pendingApprovalResolvers.get(stepId);
    if (!resolver) {
      throw new Error(`No pending approval found for step '${stepId}'`);
    }

    this.pendingApprovalResolvers.delete(stepId);
    resolver.resolve(approved);

    const pending = this.safetyGate.getPendingApprovals().find((a) => a.stepId === stepId);
    if (pending) {
      this.safetyGate.submitDecision({
        approvalId: pending.approvalId,
        workflowId: pending.workflowId,
        approved,
        decidedBy: 'USER',
        decidedAt: Date.now(),
        reason,
      });
    }
  }

  /**
   * Helper to emit progress events
   */
  private emitProgress(
    context: WorkflowContext,
    stepId: string,
    stepIndex: number,
    totalSteps: number,
    status: 'running' | 'completed' | 'paused' | 'failed' | 'resumed',
    currentStepName: string,
    message: string
  ): void {
    const percentage = totalSteps > 0
      ? Math.min(100, Math.max(0, Math.round((stepIndex / totalSteps) * 100)))
      : 0;

    const event: ProgressEvent = {
      workflowId: context.workflowId,
      executionId: `exec_${context.workflowId}_${context.startTime}`,
      stepId,
      stepIndex,
      totalSteps,
      percentage,
      status,
      currentStepName,
      message,
      timestamp: Date.now(),
    };

    this.emit('progress', event);
  }

  /**
   * Execute complete workflow from start to finish
   */
  public async executeWorkflow(
    definition: WorkflowPlan,
    context: WorkflowContext,
    options?: ExecuteWorkflowOptions
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const executionId = `exec_${context.workflowId}_${context.startTime || startTime}`;
    this.executedCompensations = [];
    this.abortController = new AbortController();
    this.isCancelled = false;
    this.stateMachine = new StateMachine(context, WorkflowState.IDLE);

    // Forward state transitions to orchestrator events
    this.stateMachine.on('transition', (data) => this.emit('stateTransition', data));

    // Audit record: Workflow Started
    this.auditTrail.recordEvent(
      AuditEventType.WORKFLOW_STARTED,
      context.workflowId,
      executionId,
      { planId: definition.id, planName: definition.name, totalSteps: definition.steps.length }
    );

    // Optional Plan Validation pre-check
    if (options?.validatePlan) {
      try {
        this.planValidator.validateOrThrow(definition);
      } catch (valErr) {
        const error = valErr instanceof Error ? valErr : new Error(String(valErr));
        this.auditTrail.recordEvent(
          AuditEventType.WORKFLOW_FAILED,
          context.workflowId,
          executionId,
          { error: error.message, reason: 'PLAN_VALIDATION_ERROR' }
        );
        const res: WorkflowResult = {
          workflowId: context.workflowId,
          finalState: WorkflowState.FAILED,
          success: false,
          startTime,
          endTime: Date.now(),
          durationMs: Date.now() - startTime,
          executedSteps: [],
          outputs: {},
          error: {
            message: error.message,
            code: 'PLAN_VALIDATION_ERROR',
          },
          context,
        };
        this.emit('workflowFailed', res);
        return res;
      }
    }

    const executedSteps: string[] = [];
    const totalSteps = definition.steps.length;
    let currentStepId: string | undefined = definition.initialStepId;
    let stepCount = 0;
    const maxSteps = definition.maxExecutionSteps ?? 50;

    // Initial progress event: 0%
    this.emitProgress(
      context,
      definition.initialStepId,
      0,
      totalSteps,
      'running',
      'Initialization',
      'Workflow started'
    );

    try {
      await this.stateMachine.transition(WorkflowEvent.START);

      while (currentStepId && stepCount < maxSteps) {
        if (this.isCancelled || this.abortController.signal.aborted) {
          throw new Error(
            `Workflow cancelled: ${this.abortController.signal.reason || 'User cancelled'}`
          );
        }

        stepCount++;
        const step = definition.steps.find((s) => s.id === currentStepId);

        if (!step) {
          throw new Error(`Step '${currentStepId}' was not found in workflow definition`);
        }

        context.currentStepId = step.id;
        const currentStepIndex = definition.steps.findIndex((s) => s.id === step.id);

        this.emit('stepStarted', { stepId: step.id, stepName: step.name, stepType: step.type });

        // Audit & Progress: Step Started
        this.auditTrail.recordEvent(
          AuditEventType.STEP_STARTED,
          context.workflowId,
          executionId,
          { stepType: step.type, description: step.description },
          { stepId: step.id, stepName: step.name }
        );
        this.emitProgress(
          context,
          step.id,
          currentStepIndex,
          totalSteps,
          'running',
          step.name,
          `Executing step ${step.name}`
        );

        // Execute the step with state transitions & safety gates
        const stepSuccess = await this.executeStep(step, context, definition, executedSteps);

        if (!stepSuccess) {
          throw new Error(`Step '${step.id}' execution failed`);
        }

        executedSteps.push(step.id);
        this.emit('stepFinished', { stepId: step.id, stepName: step.name });

        // Audit: Step Completed
        this.auditTrail.recordEvent(
          AuditEventType.STEP_COMPLETED,
          context.workflowId,
          executionId,
          { output: context.stepResults[step.id] },
          { stepId: step.id, stepName: step.name }
        );

        // Save progress checkpoint after each step
        if (options?.checkpointAfterEachStep !== false) {
          const checkpoint = await this.checkpointManager.saveCheckpoint(
            definition,
            context,
            this.stateMachine.getState(),
            step.id,
            executedSteps
          );
          this.auditTrail.recordEvent(
            AuditEventType.CHECKPOINT_SAVED,
            context.workflowId,
            executionId,
            { checkpointId: checkpoint.checkpointId, stepId: step.id },
            { stepId: step.id, stepName: step.name }
          );
        }

        // Progress update after step completion
        this.emitProgress(
          context,
          step.id,
          currentStepIndex + 1,
          totalSteps,
          'running',
          step.name,
          `Completed step ${step.name}`
        );

        // Check for cancellation after step
        if (this.isCancelled || this.abortController.signal.aborted) {
          throw new Error(
            `Workflow cancelled: ${this.abortController.signal.reason || 'User cancelled'}`
          );
        }

        // Determine next step from transitions
        currentStepId = this.evaluateNextStep(step.id, definition.transitions, context);
      }

      if (stepCount >= maxSteps) {
        throw new Error(`Workflow exceeded maximum execution step limit of ${maxSteps}`);
      }

      // Transition to final RESPONDING -> COMPLETED
      if (this.stateMachine.getState() !== WorkflowState.RESPONDING) {
        if (this.stateMachine.canTransition(WorkflowEvent.RESPOND)) {
          await this.stateMachine.transition(WorkflowEvent.RESPOND);
        }
      }

      if (this.stateMachine.canTransition(WorkflowEvent.COMPLETE)) {
        await this.stateMachine.transition(WorkflowEvent.COMPLETE);
      }

      const endTime = Date.now();
      const result: WorkflowResult = {
        workflowId: context.workflowId,
        finalState: this.stateMachine.getState(),
        success: true,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        executedSteps,
        outputs: { ...context.variables, ...context.stepResults },
        context,
      };

      // Audit & Progress: Workflow Completed
      this.auditTrail.recordEvent(
        AuditEventType.WORKFLOW_COMPLETED,
        context.workflowId,
        executionId,
        { durationMs: endTime - startTime, executedSteps }
      );
      this.emitProgress(
        context,
        'COMPLETED',
        totalSteps,
        totalSteps,
        'completed',
        'Done',
        'Workflow completed successfully'
      );

      this.emit('workflowCompleted', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      context.logs.push({
        timestamp: Date.now(),
        level: 'ERROR',
        message: `Workflow aborted due to error: ${error.message}`,
      });

      // Save Failure Checkpoint
      const failedStep = context.currentStepId ?? 'unknown';
      try {
        const failCkpt = await this.checkpointManager.createFailureCheckpoint(
          definition,
          context,
          this.stateMachine?.getState() ?? WorkflowState.FAILED,
          failedStep,
          executedSteps,
          { message: error.message, code: this.isCancelled ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_ERROR' }
        );
        this.auditTrail.recordEvent(
          AuditEventType.CHECKPOINT_SAVED,
          context.workflowId,
          executionId,
          { checkpointId: failCkpt.checkpointId, status: CheckpointStatus.FAILED },
          { stepId: failedStep }
        );
      } catch {
        // Safe fallback if checkpoint save fails during error
      }

      // Execute Saga pattern compensations in reverse order
      if (this.executedCompensations.length > 0) {
        await this.recoveryEngine.executeCompensations(
          this.executedCompensations,
          context,
          this.toolExecutor
        );
      }

      if (this.isCancelled || this.abortController.signal.aborted) {
        if (this.stateMachine?.canTransition(WorkflowEvent.ABORT)) {
          await this.stateMachine.transition(WorkflowEvent.ABORT);
        }
        this.auditTrail.recordEvent(
          AuditEventType.WORKFLOW_CANCELLED,
          context.workflowId,
          executionId,
          { error: error.message }
        );
      } else if (this.stateMachine?.canTransition(WorkflowEvent.FAIL)) {
        await this.stateMachine.transition(WorkflowEvent.FAIL, { error: error.message });
        this.auditTrail.recordEvent(
          AuditEventType.WORKFLOW_FAILED,
          context.workflowId,
          executionId,
          { error: error.message, failedStep }
        );
      }

      const endTime = Date.now();
      const result: WorkflowResult = {
        workflowId: context.workflowId,
        finalState: this.stateMachine?.getState() ?? WorkflowState.FAILED,
        success: false,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        executedSteps,
        outputs: { ...context.variables, ...context.stepResults },
        error: {
          stepId: context.currentStepId,
          message: error.message,
          code: this.isCancelled ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_EXECUTION_FAILURE',
          stack: error.stack,
        },
        context,
      };

      this.emitProgress(
        context,
        failedStep,
        executedSteps.length,
        totalSteps,
        'failed',
        'Failure',
        `Workflow failed: ${error.message}`
      );

      this.emit('workflowFailed', result);
      return result;
    }
  }

  /**
   * Resume workflow execution from a saved checkpoint.
   * CRITICAL INVARIANT: Already completed steps are NEVER re-executed!
   */
  public async resumeWorkflow(
    checkpointId: string,
    options?: ResumeOptions
  ): Promise<WorkflowResult> {
    const checkpoint = await this.checkpointManager.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint '${checkpointId}' was not found`);
    }

    const definition = checkpoint.plan;
    if (options?.validatePlan) {
      this.planValidator.validateOrThrow(definition);
    }

    const startTime = Date.now();
    const executionId = `exec_${checkpoint.workflowId}_${startTime}_resumed`;
    this.executedCompensations = [];
    this.abortController = new AbortController();
    this.isCancelled = false;

    // Reconstruct context from checkpoint snapshot
    const context: WorkflowContext = {
      workflowId: checkpoint.workflowId,
      name: definition.name,
      userRequest: {
        requestId: `req_resume_${Date.now()}`,
        sessionId: `sess_resumed`,
        intent: definition.name,
        timestamp: Date.now(),
      },
      appContext: {
        activeApplication: 'VS Code - Academia AI Co-Pilot',
        windowTitle: 'Workspace (Resumed)',
        visibleContent: 'Resumed execution context',
      },
      stepResults: { ...checkpoint.stepResults },
      variables: { ...checkpoint.variables, ...(options?.overrideVariables || {}) },
      currentStepId: checkpoint.stepId,
      attemptsPerStep: { ...checkpoint.attemptsPerStep },
      approvals: { ...checkpoint.approvals },
      logs: [
        {
          timestamp: Date.now(),
          level: 'INFO',
          message: `Resuming workflow from checkpoint '${checkpointId}' at step '${checkpoint.stepId}'`,
        },
      ],
      startTime: checkpoint.timestamp,
    };

    // Initialize state machine
    this.stateMachine = new StateMachine(context, WorkflowState.IDLE);
    this.stateMachine.on('transition', (data) => this.emit('stateTransition', data));

    // Audit and progress: Workflow Resumed
    this.auditTrail.recordEvent(
      AuditEventType.WORKFLOW_RESUMED,
      context.workflowId,
      executionId,
      {
        fromCheckpointId: checkpointId,
        resumedAtStepId: checkpoint.stepId,
        completedStepIds: checkpoint.completedStepIds,
      }
    );
    this.emit('workflowResumed', { checkpointId, checkpoint });

    const executedSteps = [...checkpoint.completedStepIds];
    const totalSteps = definition.steps.length;

    // Determine starting step for resumption
    let currentStepId: string | undefined;
    const isAlreadyCompleted = checkpoint.completedStepIds.includes(checkpoint.stepId);

    if (isAlreadyCompleted) {
      // Checkpoint was saved after step finished; advance to next step
      currentStepId = this.evaluateNextStep(checkpoint.stepId, definition.transitions, context);
    } else {
      // Checkpoint was saved before or during this step (e.g. pending approval or failed step)
      currentStepId = checkpoint.stepId;
    }

    this.emitProgress(
      context,
      currentStepId ?? checkpoint.stepId,
      executedSteps.length,
      totalSteps,
      'resumed',
      'Resume',
      `Workflow resumed from step ${currentStepId ?? checkpoint.stepId}`
    );

    let stepCount = executedSteps.length;
    const maxSteps = definition.maxExecutionSteps ?? 50;

    try {
      await this.stateMachine.transition(WorkflowEvent.START);

      while (currentStepId && stepCount < maxSteps) {
        if (this.isCancelled || this.abortController.signal.aborted) {
          throw new Error(
            `Workflow cancelled: ${this.abortController.signal.reason || 'User cancelled'}`
          );
        }

        // CRITICAL INVARIANT CHECK: Skip step if already completed in checkpoint
        if (executedSteps.includes(currentStepId)) {
          this.auditTrail.recordEvent(
            AuditEventType.STEP_SKIPPED,
            context.workflowId,
            executionId,
            { reason: 'Step was already completed prior to resume checkpoint' },
            { stepId: currentStepId }
          );
          currentStepId = this.evaluateNextStep(currentStepId, definition.transitions, context);
          continue;
        }

        stepCount++;
        const step = definition.steps.find((s) => s.id === currentStepId);

        if (!step) {
          throw new Error(`Step '${currentStepId}' was not found in workflow definition`);
        }

        context.currentStepId = step.id;
        const currentStepIndex = definition.steps.findIndex((s) => s.id === step.id);

        this.emit('stepStarted', { stepId: step.id, stepName: step.name, stepType: step.type });

        // Audit & Progress
        this.auditTrail.recordEvent(
          AuditEventType.STEP_STARTED,
          context.workflowId,
          executionId,
          { stepType: step.type, description: step.description },
          { stepId: step.id, stepName: step.name }
        );
        this.emitProgress(
          context,
          step.id,
          currentStepIndex,
          totalSteps,
          'running',
          step.name,
          `Executing resumed step ${step.name}`
        );

        // Execute step
        const stepSuccess = await this.executeStep(step, context, definition, executedSteps);

        if (!stepSuccess) {
          throw new Error(`Step '${step.id}' execution failed`);
        }

        executedSteps.push(step.id);
        this.emit('stepFinished', { stepId: step.id, stepName: step.name });

        // Audit: Step Completed
        this.auditTrail.recordEvent(
          AuditEventType.STEP_COMPLETED,
          context.workflowId,
          executionId,
          { output: context.stepResults[step.id] },
          { stepId: step.id, stepName: step.name }
        );

        // Save progress checkpoint
        const postStepCheckpoint = await this.checkpointManager.saveCheckpoint(
          definition,
          context,
          this.stateMachine.getState(),
          step.id,
          executedSteps
        );
        this.auditTrail.recordEvent(
          AuditEventType.CHECKPOINT_SAVED,
          context.workflowId,
          executionId,
          { checkpointId: postStepCheckpoint.checkpointId, stepId: step.id },
          { stepId: step.id, stepName: step.name }
        );

        this.emitProgress(
          context,
          step.id,
          currentStepIndex + 1,
          totalSteps,
          'running',
          step.name,
          `Completed step ${step.name}`
        );

        currentStepId = this.evaluateNextStep(step.id, definition.transitions, context);
      }

      // Transition to final RESPONDING -> COMPLETED
      if (this.stateMachine.getState() !== WorkflowState.RESPONDING) {
        if (this.stateMachine.canTransition(WorkflowEvent.RESPOND)) {
          await this.stateMachine.transition(WorkflowEvent.RESPOND);
        }
      }

      if (this.stateMachine.canTransition(WorkflowEvent.COMPLETE)) {
        await this.stateMachine.transition(WorkflowEvent.COMPLETE);
      }

      const endTime = Date.now();
      const result: WorkflowResult = {
        workflowId: context.workflowId,
        finalState: this.stateMachine.getState(),
        success: true,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        executedSteps,
        outputs: { ...context.variables, ...context.stepResults },
        context,
      };

      this.auditTrail.recordEvent(
        AuditEventType.WORKFLOW_COMPLETED,
        context.workflowId,
        executionId,
        { durationMs: endTime - startTime, executedSteps }
      );
      this.emitProgress(
        context,
        'COMPLETED',
        totalSteps,
        totalSteps,
        'completed',
        'Done',
        'Workflow completed successfully after resume'
      );

      this.emit('workflowCompleted', result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const failedStep = context.currentStepId ?? 'unknown';

      // Save failure checkpoint
      try {
        await this.checkpointManager.createFailureCheckpoint(
          definition,
          context,
          this.stateMachine?.getState() ?? WorkflowState.FAILED,
          failedStep,
          executedSteps,
          { message: error.message, code: 'WORKFLOW_RESUME_FAILURE' }
        );
      } catch {
        // Safe fallback
      }

      if (this.stateMachine?.canTransition(WorkflowEvent.FAIL)) {
        await this.stateMachine.transition(WorkflowEvent.FAIL, { error: error.message });
      }

      const endTime = Date.now();
      const result: WorkflowResult = {
        workflowId: context.workflowId,
        finalState: this.stateMachine?.getState() ?? WorkflowState.FAILED,
        success: false,
        startTime,
        endTime,
        durationMs: endTime - startTime,
        executedSteps,
        outputs: { ...context.variables, ...context.stepResults },
        error: {
          stepId: context.currentStepId,
          message: error.message,
          code: 'WORKFLOW_RESUME_FAILURE',
          stack: error.stack,
        },
        context,
      };

      this.emit('workflowFailed', result);
      return result;
    }
  }

  /**
   * Executes a single workflow step respecting state machine transitions and safety gates
   */
  private async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    definition?: WorkflowPlan,
    executedSteps: string[] = []
  ): Promise<boolean> {
    switch (step.type) {
      case StepType.OBSERVATION:
        return this.executeObservationStep(step, context);

      case StepType.REASONING:
        return this.executeReasoningStep(step, context);

      case StepType.PLANNING:
        return this.executePlanningStep(step, context);

      case StepType.TOOL_EXECUTION:
        return this.executeToolStep(step, context, definition, executedSteps);

      case StepType.VERIFICATION:
        return this.executeVerificationStep(step, context);

      case StepType.RESPONSE:
        return this.executeResponseStep(step, context);

      case StepType.HUMAN_APPROVAL:
        return this.executeApprovalStep(step, context, definition, executedSteps);

      default:
        return this.executeToolStep(step, context, definition, executedSteps);
    }
  }

  private async executeObservationStep(step: WorkflowStep, context: WorkflowContext): Promise<boolean> {
    if (this.stateMachine.canTransition(WorkflowEvent.OBSERVE)) {
      await this.stateMachine.transition(WorkflowEvent.OBSERVE);
    }

    if (step.toolName) {
      await this.runToolWithRetry(step, context);
    } else {
      context.stepResults[step.id] = {
        screenContext: context.appContext.visibleContent ?? 'Screen text captured',
        activeApp: context.appContext.activeApplication ?? 'VS Code',
      };
    }

    if (this.stateMachine.canTransition(WorkflowEvent.OBSERVE_DONE)) {
      await this.stateMachine.transition(WorkflowEvent.OBSERVE_DONE);
    }
    return true;
  }

  private async executeReasoningStep(step: WorkflowStep, context: WorkflowContext): Promise<boolean> {
    if (this.stateMachine.canTransition(WorkflowEvent.REASON)) {
      await this.stateMachine.transition(WorkflowEvent.REASON);
    }

    if (step.toolName) {
      await this.runToolWithRetry(step, context);
    } else {
      context.stepResults[step.id] = {
        intent: context.userRequest.intent ?? 'task_execution',
        reasoning: `Analyzed user request '${context.userRequest.rawVoiceInput ?? context.userRequest.intent}' with active context`,
      };
    }

    if (this.stateMachine.canTransition(WorkflowEvent.REASON_DONE)) {
      await this.stateMachine.transition(WorkflowEvent.REASON_DONE);
    }
    return true;
  }

  private async executePlanningStep(step: WorkflowStep, context: WorkflowContext): Promise<boolean> {
    if (this.stateMachine.canTransition(WorkflowEvent.PLAN)) {
      await this.stateMachine.transition(WorkflowEvent.PLAN);
    }

    context.stepResults[step.id] = {
      planCreated: true,
      timestamp: Date.now(),
    };

    if (this.stateMachine.canTransition(WorkflowEvent.PLAN_DONE)) {
      await this.stateMachine.transition(WorkflowEvent.PLAN_DONE);
    }
    return true;
  }

  private async executeToolStep(
    step: WorkflowStep,
    context: WorkflowContext,
    definition?: WorkflowPlan,
    executedSteps: string[] = []
  ): Promise<boolean> {
    if (!step.toolName) {
      throw new Error(`Step '${step.id}' is of type TOOL_EXECUTION but has no toolName specified`);
    }

    const toolDef = this.toolExecutor.getTool(step.toolName);
    const riskLevel = step.riskLevel ?? toolDef?.riskLevel ?? RiskLevel.B_LOW_RISK;
    const resolvedParams = this.resolveParameters(step, context);

    let approvalToken: string | undefined;

    // Evaluate Safety Gate
    const approvalCheck = this.safetyGate.evaluate(
      context.workflowId,
      step.id,
      step.toolName,
      riskLevel,
      resolvedParams,
      step.description
    );

    if (approvalCheck.requiresApproval) {
      const approvalReq = approvalCheck.approvalRequest!;
      approvalToken = approvalReq.approvalId;

      if (this.stateMachine.canTransition(WorkflowEvent.REQUIRE_APPROVAL)) {
        await this.stateMachine.transition(WorkflowEvent.REQUIRE_APPROVAL, approvalReq);
      }

      // Save Pre-Approval Checkpoint so state is safe if paused/resumed
      if (definition) {
        try {
          const preApprovalCkpt = await this.checkpointManager.saveCheckpoint(
            definition,
            context,
            WorkflowState.AWAITING_APPROVAL,
            step.id,
            executedSteps,
            { status: CheckpointStatus.ACTIVE, metadata: { awaitingApprovalForStep: step.id } }
          );
          this.auditTrail.recordEvent(
            AuditEventType.CHECKPOINT_SAVED,
            context.workflowId,
            `exec_${context.workflowId}_${context.startTime}`,
            { checkpointId: preApprovalCkpt.checkpointId, reason: 'PRE_APPROVAL_GATE' },
            { stepId: step.id, stepName: step.name }
          );
        } catch {
          // Non-blocking
        }
      }

      this.auditTrail.recordEvent(
        AuditEventType.APPROVAL_REQUESTED,
        context.workflowId,
        `exec_${context.workflowId}_${context.startTime}`,
        { approvalId: approvalReq.approvalId, riskLevel, toolName: step.toolName },
        { stepId: step.id, stepName: step.name }
      );

      this.emit('approvalRequested', approvalReq);

      // Wait for approval response
      const approved = await new Promise<boolean>((resolve, reject) => {
        this.pendingApprovalResolvers.set(step.id, { resolve, reject });
      });

      context.approvals[step.id] = approved;

      // Check if expired
      if (this.safetyGate.isExpired(approvalReq.approvalId)) {
        context.logs.push({
          timestamp: Date.now(),
          level: 'WARN',
          message: `Approval for tool '${step.toolName}' in step '${step.id}' has EXPIRED. Expired actions never execute.`,
        });

        this.auditTrail.recordEvent(
          AuditEventType.APPROVAL_EXPIRED,
          context.workflowId,
          `exec_${context.workflowId}_${context.startTime}`,
          { approvalId: approvalReq.approvalId },
          { stepId: step.id, stepName: step.name }
        );

        if (this.stateMachine.canTransition(WorkflowEvent.REJECT)) {
          await this.stateMachine.transition(WorkflowEvent.REJECT);
        }
        return false;
      }

      // Check if rejected
      if (!approved) {
        context.logs.push({
          timestamp: Date.now(),
          level: 'WARN',
          message: `User rejected execution of tool '${step.toolName}' in step '${step.id}'. Rejected actions never execute.`,
        });

        this.safetyGate.getApprovalManager().reject(approvalReq.approvalId, 'User denied approval');

        this.auditTrail.recordEvent(
          AuditEventType.APPROVAL_REJECTED,
          context.workflowId,
          `exec_${context.workflowId}_${context.startTime}`,
          { approvalId: approvalReq.approvalId, reason: 'User denied' },
          { stepId: step.id, stepName: step.name }
        );

        if (this.stateMachine.canTransition(WorkflowEvent.REJECT)) {
          await this.stateMachine.transition(WorkflowEvent.REJECT);
        }

        // Try fallback if available
        if (step.fallbackAction) {
          const fallback = await this.recoveryEngine.handleFallback(
            step,
            new Error(`User rejected approval request for step '${step.id}'`),
            context
          );
          if (fallback.handled && fallback.output) {
            context.stepResults[step.id] = fallback.output;
            return true;
          }
        }
        return false;
      }

      // Approved!
      const decision = this.safetyGate.getApprovalManager().approve(approvalReq.approvalId);
      this.auditTrail.recordEvent(
        AuditEventType.APPROVAL_GRANTED,
        context.workflowId,
        `exec_${context.workflowId}_${context.startTime}`,
        { approvalId: approvalReq.approvalId, decidedBy: decision.decidedBy },
        { stepId: step.id, stepName: step.name }
      );

      if (this.stateMachine.canTransition(WorkflowEvent.APPROVE)) {
        await this.stateMachine.transition(WorkflowEvent.APPROVE);
      }
    } else {
      if (this.stateMachine.canTransition(WorkflowEvent.EXECUTE_TOOL)) {
        await this.stateMachine.transition(WorkflowEvent.EXECUTE_TOOL, {
          toolName: step.toolName,
          stepId: step.id,
        });
      }
    }

    // Run tool execution with retry policy and bounded retries for idempotent calls only
    const result = await this.runToolWithRetry(
      step,
      context,
      resolvedParams,
      riskLevel,
      approvalToken
    );

    if (result.success) {
      if (this.stateMachine.canTransition(WorkflowEvent.TOOL_SUCCESS)) {
        await this.stateMachine.transition(WorkflowEvent.TOOL_SUCCESS);
      }

      // Register compensation action if defined (for rollback)
      if (step.compensationAction) {
        this.executedCompensations.push(step.compensationAction);
      }
      return true;
    } else {
      if (this.stateMachine.canTransition(WorkflowEvent.TOOL_FAILURE)) {
        await this.stateMachine.transition(WorkflowEvent.TOOL_FAILURE, result.error);
      }
      return false;
    }
  }

  private async executeVerificationStep(step: WorkflowStep, context: WorkflowContext): Promise<boolean> {
    if (this.stateMachine.canTransition(WorkflowEvent.VERIFY)) {
      await this.stateMachine.transition(WorkflowEvent.VERIFY);
    }

    context.stepResults[step.id] = {
      verified: true,
      timestamp: Date.now(),
    };

    if (this.stateMachine.canTransition(WorkflowEvent.VERIFY_SUCCESS)) {
      await this.stateMachine.transition(WorkflowEvent.VERIFY_SUCCESS);
    }
    return true;
  }

  private async executeResponseStep(step: WorkflowStep, context: WorkflowContext): Promise<boolean> {
    if (this.stateMachine.canTransition(WorkflowEvent.RESPOND)) {
      await this.stateMachine.transition(WorkflowEvent.RESPOND);
    }

    if (step.toolName) {
      await this.runToolWithRetry(step, context);
    } else {
      context.stepResults[step.id] = {
        responseDelivered: true,
        text: `Completed workflow tasks successfully.`,
      };
    }

    if (this.stateMachine.canTransition(WorkflowEvent.RESPOND_DONE)) {
      await this.stateMachine.transition(WorkflowEvent.RESPOND_DONE);
    }
    return true;
  }

  private async executeApprovalStep(
    step: WorkflowStep,
    context: WorkflowContext,
    definition?: WorkflowPlan,
    executedSteps: string[] = []
  ): Promise<boolean> {
    return this.executeToolStep(step, context, definition, executedSteps);
  }

  /**
   * Run tool execution wrapped with retry policy, timeout, cancellation signal,
   * and IDEMPOTENCY KEY caching.
   * Retries are bounded and executed ONLY for idempotent calls!
   * Duplicate calls with identical idempotency keys return cached results and NEVER execute the tool!
   */
  private async runToolWithRetry(
    step: WorkflowStep,
    context: WorkflowContext,
    paramsOverride?: Record<string, unknown>,
    riskOverride?: RiskLevel,
    approvalToken?: string
  ) {
    const params = paramsOverride ?? this.resolveParameters(step, context);
    const toolDef = this.toolExecutor.getTool(step.toolName!);
    const riskLevel = riskOverride ?? step.riskLevel ?? toolDef?.riskLevel ?? RiskLevel.B_LOW_RISK;

    const callerKey =
      (step.metadata?.idempotencyKey as string) ||
      (context.variables?.[`${step.id}_idempotencyKey`] as string) ||
      (context.variables?.idempotencyKey as string);

    const idempotencyKey = this.idempotencyManager.computeKey(step.toolName!, params, {
      workflowId: context.workflowId,
      stepId: step.id,
      callerKey,
    });

    const isIdempotent =
      step.isIdempotent ??
      toolDef?.isIdempotent ??
      (riskLevel === RiskLevel.A_INFORMATIONAL);

    // IDEMPOTENCY CHECK: Return cached result if already executed
    if (step.isIdempotent || step.metadata?.idempotencyKey || step.metadata?.useIdempotency !== false) {
      if (this.idempotencyManager.has(idempotencyKey)) {
        const cached = this.idempotencyManager.get(idempotencyKey)!;
        cached.executionCount++;
        this.auditTrail.recordEvent(
          AuditEventType.TOOL_INVOKED,
          context.workflowId,
          `exec_${context.workflowId}_${context.startTime}`,
          {
            toolName: step.toolName,
            parameters: params,
            cached: true,
            idempotencyKey,
            executionCount: cached.executionCount,
          },
          { stepId: step.id, stepName: step.name }
        );

        context.stepResults[step.id] = cached.result;
        if (step.outputVariable) {
          context.variables[step.outputVariable] = cached.result;
        }

        return {
          success: true,
          data: cached.result,
          durationMs: 0,
          timestamp: Date.now(),
          requestId: 'idempotent_cached',
          toolName: step.toolName!,
        };
      }
    }

    const executeOperation = async () => {
      const request: ToolExecutionRequest = {
        requestId: `req_${context.workflowId}_${step.id}_${Date.now()}`,
        workflowId: context.workflowId,
        stepId: step.id,
        toolName: step.toolName!,
        parameters: params,
        riskLevel,
        timeoutMs: step.timeoutMs,
        approvalToken,
        signal: this.abortController.signal,
        grantedScopes:
          (context.variables?.grantedScopes as string[]) ??
          step.requiredScopes ??
          toolDef?.requiredScopes,
      };

      this.auditTrail.recordEvent(
        AuditEventType.TOOL_INVOKED,
        context.workflowId,
        `exec_${context.workflowId}_${context.startTime}`,
        { toolName: step.toolName, parameters: params, riskLevel, idempotencyKey },
        { stepId: step.id, stepName: step.name }
      );

      const result = await this.toolExecutor.execute(request);
      if (!result.success) {
        const err = new Error(result.error?.message ?? `Tool '${step.toolName}' failed`);
        (err as { code?: string }).code = result.error?.code;
        throw err;
      }
      return result;
    };

    try {
      let finalResult;

      // Bounded retries for idempotent calls ONLY
      if (step.retryPolicy && isIdempotent) {
        // Enforce bounded retries (cap at max 5)
        const boundedPolicy = {
          ...step.retryPolicy,
          maxAttempts: Math.min(step.retryPolicy.maxAttempts, 5),
        };
        finalResult = await this.recoveryEngine.executeWithRetry(
          executeOperation,
          boundedPolicy,
          context,
          step.id
        );
      } else {
        if (step.retryPolicy && !isIdempotent) {
          context.logs.push({
            timestamp: Date.now(),
            level: 'WARN',
            message: `Tool '${step.toolName}' in step '${step.id}' is non-idempotent; skipping retries to prevent duplicate side effects.`,
          });
        }
        finalResult = await executeOperation();
      }

      // Record result in idempotency cache
      if (step.isIdempotent || step.metadata?.idempotencyKey || step.metadata?.useIdempotency !== false) {
        this.idempotencyManager.recordResult(
          idempotencyKey,
          step.toolName!,
          params,
          finalResult.data,
          { workflowId: context.workflowId, stepId: step.id }
        );
      }

      context.stepResults[step.id] = finalResult.data;
      if (step.outputVariable) {
        context.variables[step.outputVariable] = finalResult.data;
      }
      return finalResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Attempt fallback if configured
      if (step.fallbackAction) {
        const fallback = await this.recoveryEngine.handleFallback(step, error, context);
        if (fallback.handled) {
          if (fallback.output !== undefined) {
            context.stepResults[step.id] = fallback.output;
            if (step.outputVariable) {
              context.variables[step.outputVariable] = fallback.output;
            }
            return {
              success: true,
              data: fallback.output,
              durationMs: 0,
              timestamp: Date.now(),
              requestId: 'fallback',
              toolName: step.toolName!,
            };
          }
        }
      }

      return {
        success: false,
        durationMs: 0,
        timestamp: Date.now(),
        requestId: 'failed',
        toolName: step.toolName!,
        error: {
          code: (error as { code?: string }).code ?? 'TOOL_EXECUTION_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Resolve dynamic step parameters from context or parameter function
   */
  private resolveParameters(step: WorkflowStep, context: WorkflowContext): Record<string, unknown> {
    if (typeof step.toolParameters === 'function') {
      return step.toolParameters(context);
    }

    if (!step.toolParameters) {
      return {};
    }

    const resolved: Record<string, unknown> = { ...step.toolParameters };

    // Apply input mappings if defined: { "paramName": "context.variableKey" }
    if (step.inputMapping) {
      for (const [targetParam, sourceKey] of Object.entries(step.inputMapping)) {
        if (sourceKey in context.variables) {
          resolved[targetParam] = context.variables[sourceKey];
        } else if (sourceKey in context.stepResults) {
          resolved[targetParam] = context.stepResults[sourceKey];
        }
      }
    }

    return resolved;
  }

  /**
   * Evaluates conditional transitions to select the next workflow step
   */
  private evaluateNextStep(
    currentStepId: string,
    transitions: WorkflowTransition[],
    context: WorkflowContext
  ): string | undefined {
    const stepTransitions = transitions.filter((t) => t.fromStepId === currentStepId);

    if (stepTransitions.length === 0) {
      return undefined;
    }

    // Evaluate conditional transitions first
    for (const transition of stepTransitions) {
      if (transition.condition && this.evaluateCondition(transition.condition, context)) {
        return transition.toStepId;
      }
    }

    // Fall back to default transition
    const defaultTransition = stepTransitions.find((t) => t.isDefault || !t.condition);
    return defaultTransition ? defaultTransition.toStepId : undefined;
  }

  private evaluateCondition(
    condition: import('../types/workflow.js').StepCondition,
    context: WorkflowContext
  ): boolean {
    if (condition.customEvaluator) {
      return condition.customEvaluator(context);
    }

    if (!condition.field) {
      return true;
    }

    const actualValue = this.resolvePath(context as unknown as Record<string, unknown>, condition.field);

    switch (condition.operator) {
      case 'equals':
        return actualValue === condition.value;
      case 'notEquals':
        return actualValue !== condition.value;
      case 'contains':
        return String(actualValue).includes(String(condition.value));
      case 'greaterThan':
        return Number(actualValue) > Number(condition.value);
      case 'lessThan':
        return Number(actualValue) < Number(condition.value);
      case 'defined':
        return actualValue !== undefined && actualValue !== null;
      default:
        return false;
    }
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const effectivePath = path.startsWith('variables.') ? path.slice('variables.'.length) : path;

    if (effectivePath.startsWith('stepResults.')) {
      const rest = effectivePath.slice('stepResults.'.length);
      const parts = rest.split('.');
      let current: unknown = obj.stepResults;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    }

    if (obj.variables && typeof obj.variables === 'object') {
      const parts = effectivePath.split('.');
      let current: unknown = obj.variables;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      if (current !== undefined) return current;
    }

    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
