/**
 * Error Recovery & Fault Tolerance Schemas
 * SDE-8 Agentic Workflow Orchestration
 */

import { WorkflowContext } from './workflow.js';

export enum RecoveryStrategy {
  RETRY = 'RETRY',
  FALLBACK_STEP = 'FALLBACK_STEP',
  REQUEST_CLARIFICATION = 'REQUEST_CLARIFICATION',
  ESCALATE_TO_HUMAN = 'ESCALATE_TO_HUMAN',
  COMPENSATE_AND_ABORT = 'COMPENSATE_AND_ABORT',
  SKIP_AND_CONTINUE = 'SKIP_AND_CONTINUE',
}

/**
 * Policy for retrying a failed step
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs?: number;
  retryableErrorCodes?: string[];
}

/**
 * Fallback action when retries fail
 */
export interface FallbackAction {
  type: 'ALTERNATIVE_STEP' | 'DEFAULT_OUTPUT' | 'ASK_USER' | 'ABORT';
  fallbackStepId?: string;
  defaultOutput?: Record<string, unknown>;
  clarificationPrompt?: string;
  onFallback?: (context: WorkflowContext, error: Error) => Promise<unknown> | unknown;
}

/**
 * Compensation action to undo side effects on failure (Saga pattern)
 */
export interface CompensationAction {
  id: string;
  description: string;
  toolName: string;
  parameters: Record<string, unknown> | ((context: WorkflowContext) => Record<string, unknown>);
  runOnFailureOnly: boolean;
}

/**
 * Classification of workflow errors
 */
export interface StepExecutionError extends Error {
  code: string;
  stepId: string;
  isRetryable: boolean;
  details?: unknown;
  originalError?: Error;
}
