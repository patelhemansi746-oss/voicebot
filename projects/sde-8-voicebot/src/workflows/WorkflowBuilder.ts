/**
 * Fluent Workflow Builder
 * Provides an intuitive, type-safe API for constructing multi-step agentic workflows
 */

import {
  type WorkflowPlan,
  type WorkflowStep,
  StepType,
  type StepCondition,
} from '../types/workflow.js';
import type { RiskLevel } from '../types/safety.js';
import type { RetryPolicy, FallbackAction, CompensationAction } from '../types/error-recovery.js';

export class WorkflowBuilder {
  private definition: WorkflowPlan;

  constructor(id: string, name: string, description = '') {
    this.definition = {
      id,
      name,
      version: '1.0.0',
      description,
      initialStepId: '',
      steps: [],
      transitions: [],
    };
  }

  public setInitialStep(stepId: string): this {
    this.definition.initialStepId = stepId;
    return this;
  }

  public setTimeout(timeoutMs: number): this {
    this.definition.defaultTimeoutMs = timeoutMs;
    return this;
  }

  public setMaxSteps(maxSteps: number): this {
    this.definition.maxExecutionSteps = maxSteps;
    return this;
  }

  public addStep(step: WorkflowStep): this {
    if (!this.definition.initialStepId) {
      this.definition.initialStepId = step.id;
    }
    this.definition.steps.push(step);
    return this;
  }

  public addObservationStep(id: string, name: string, toolName?: string, toolParameters?: Record<string, unknown>): this {
    return this.addStep({
      id,
      name,
      type: StepType.OBSERVATION,
      description: `Observation step: ${name}`,
      toolName,
      toolParameters,
    });
  }

  public addReasoningStep(id: string, name: string, description = ''): this {
    return this.addStep({
      id,
      name,
      type: StepType.REASONING,
      description: description || `Reasoning step: ${name}`,
    });
  }

  public addPlanningStep(id: string, name: string, description = ''): this {
    return this.addStep({
      id,
      name,
      type: StepType.PLANNING,
      description: description || `Planning step: ${name}`,
    });
  }

  public addToolStep(
    id: string,
    name: string,
    toolName: string,
    toolParameters?: Record<string, unknown> | WorkflowStep['toolParameters'],
    options?: {
      riskLevel?: RiskLevel;
      outputVariable?: string;
      inputMapping?: Record<string, string>;
      retryPolicy?: RetryPolicy;
      fallbackAction?: FallbackAction;
      compensationAction?: CompensationAction;
      timeoutMs?: number;
    }
  ): this {
    return this.addStep({
      id,
      name,
      type: StepType.TOOL_EXECUTION,
      description: `Tool invocation: ${name} using ${toolName}`,
      toolName,
      toolParameters,
      riskLevel: options?.riskLevel,
      outputVariable: options?.outputVariable,
      inputMapping: options?.inputMapping,
      retryPolicy: options?.retryPolicy,
      fallbackAction: options?.fallbackAction,
      compensationAction: options?.compensationAction,
      timeoutMs: options?.timeoutMs,
    });
  }

  public addVerificationStep(id: string, name: string, description = ''): this {
    return this.addStep({
      id,
      name,
      type: StepType.VERIFICATION,
      description: description || `Verification step: ${name}`,
    });
  }

  public addResponseStep(id: string, name: string, description = ''): this {
    return this.addStep({
      id,
      name,
      type: StepType.RESPONSE,
      description: description || `Response generation: ${name}`,
    });
  }

  public addTransition(fromStepId: string, toStepId: string, condition?: StepCondition, isDefault = false): this {
    this.definition.transitions.push({
      fromStepId,
      toStepId,
      condition,
      isDefault,
    });
    return this;
  }

  public addSequentialTransitions(): this {
    for (let i = 0; i < this.definition.steps.length - 1; i++) {
      const from = this.definition.steps[i]!.id;
      const to = this.definition.steps[i + 1]!.id;
      this.addTransition(from, to, undefined, true);
    }
    return this;
  }

  public build(): WorkflowPlan {
    if (!this.definition.initialStepId && this.definition.steps.length > 0) {
      this.definition.initialStepId = this.definition.steps[0]!.id;
    }
    return {
      ...this.definition,
      steps: this.definition.steps.map((s) => ({ ...s })),
      transitions: this.definition.transitions.map((t) => ({ ...t })),
    };
  }
}
