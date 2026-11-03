/**
 * Plan Validation Types and Contracts
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

export type ValidationErrorType =
  | 'EMPTY_WORKFLOW'
  | 'MISSING_INITIAL_STEP'
  | 'DUPLICATE_STEP_ID'
  | 'MISSING_STEP_DEPENDENCY'
  | 'MISSING_TRANSITION_STEP'
  | 'DEPENDENCY_CYCLE_DETECTED'
  | 'TRANSITION_CYCLE_DETECTED'
  | 'UNREGISTERED_TOOL'
  | 'TOOL_NOT_ALLOWLISTED'
  | 'INVALID_STEP_TYPE'
  | 'INVALID_PARAMETERS';

export interface PlanValidationErrorDetail {
  code: ValidationErrorType;
  message: string;
  stepId?: string;
  cycle?: string[];
  details?: Record<string, unknown>;
}

export interface PlanValidationResult {
  isValid: boolean;
  errors: PlanValidationErrorDetail[];
}

export interface ValidationOptions {
  /** Check if referenced tools exist in registry */
  checkToolRegistry?: boolean;
  /** Enforce that tools are in the allow-list */
  checkAllowList?: boolean;
  /** Detect cycles in transition graphs in addition to dependency graphs */
  detectTransitionCycles?: boolean;
}
