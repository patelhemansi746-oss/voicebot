/**
 * Workflow Schemas & Type Definitions
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System
 */

import { RiskLevel } from './safety.js';
import { RetryPolicy, FallbackAction, CompensationAction } from './error-recovery.js';

/**
 * Valid states of the agentic state machine
 */
export enum WorkflowState {
  IDLE = 'IDLE',
  INITIALIZING = 'INITIALIZING',
  OBSERVING = 'OBSERVING',
  REASONING = 'REASONING',
  PLANNING = 'PLANNING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  EXECUTING_TOOL = 'EXECUTING_TOOL',
  VERIFYING = 'VERIFYING',
  RESPONDING = 'RESPONDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED',
  PAUSED = 'PAUSED',
  RECOVERING = 'RECOVERING',
}

/**
 * Step execution status
 */
export enum StepStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  RETRYING = 'RETRYING',
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
}

/**
 * Types of workflow steps
 */
export enum StepType {
  OBSERVATION = 'OBSERVATION',   // Screen capture, OCR, active window context gathering
  REASONING = 'REASONING',       // LLM reasoning or heuristic decision making
  PLANNING = 'PLANNING',         // Task decomposition into steps
  TOOL_EXECUTION = 'TOOL_EXECUTION', // Invoking a controlled external tool
  VERIFICATION = 'VERIFICATION', // Checking tool result correctness
  RESPONSE = 'RESPONSE',         // Formulating voice/text response to user
  HUMAN_APPROVAL = 'HUMAN_APPROVAL', // Explicit confirmation gate
}

/**
 * Contextual environment information passed to workflow
 */
export interface ApplicationContext {
  activeApplication?: string;
  windowTitle?: string;
  documentType?: string;
  currentWorkflow?: string;
  visibleContent?: string;
  ocrText?: string;
  screenSnippetId?: string;
  terminalLogs?: string;
  metadata?: Record<string, unknown>;
}

/**
 * User request context
 */
export interface UserRequestContext {
  requestId: string;
  sessionId: string;
  rawVoiceInput?: string;
  transcription?: string;
  intent?: string;
  timestamp: number;
}

/**
 * Dynamic workflow execution context shared across steps
 */
export interface WorkflowContext {
  workflowId: string;
  name: string;
  userRequest: UserRequestContext;
  appContext: ApplicationContext;
  stepResults: Record<string, unknown>;
  variables: Record<string, unknown>;
  currentStepId?: string;
  attemptsPerStep: Record<string, number>;
  approvals: Record<string, boolean>;
  logs: Array<{
    timestamp: number;
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    message: string;
    details?: unknown;
  }>;
  startTime: number;
  endTime?: number;
}

/**
 * Condition evaluator for step transition branches
 */
export interface StepCondition {
  field?: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'defined' | 'custom';
  value?: unknown;
  customEvaluator?: (context: WorkflowContext) => boolean;
}

/**
 * Transition link between workflow steps
 */
export interface WorkflowTransition {
  fromStepId: string;
  toStepId: string;
  condition?: StepCondition;
  isDefault?: boolean;
  label?: string;
}

/**
 * Step definition in a workflow schema
 */
export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  description: string;
  toolName?: string;
  toolParameters?: Record<string, unknown> | ((context: WorkflowContext) => Record<string, unknown>);
  riskLevel?: RiskLevel;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  fallbackAction?: FallbackAction;
  compensationAction?: CompensationAction;
  inputMapping?: Record<string, string>; // Maps context variables to step inputs
  outputVariable?: string; // Saves step output to context.variables[outputVariable]
  metadata?: Record<string, unknown>;
  dependencies?: string[]; // IDs of preceding steps this step depends on
  dependsOn?: string[]; // Alias for dependencies
  isIdempotent?: boolean; // Whether this step is safe to retry on failure
  requiredScopes?: string[]; // Permission scopes required for this step
}

/**
 * Top-level Workflow Plan Schema
 */
export interface WorkflowPlan {
  id: string;
  name: string;
  version: string;
  description: string;
  initialStepId: string;
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
  defaultTimeoutMs?: number;
  maxExecutionSteps?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Backward compatibility alias
 */
export type WorkflowDefinition = WorkflowPlan;

/**
 * Result of executing an entire workflow
 */
export interface WorkflowResult {
  workflowId: string;
  finalState: WorkflowState;
  success: boolean;
  startTime: number;
  endTime: number;
  durationMs: number;
  executedSteps: string[];
  outputs: Record<string, unknown>;
  error?: {
    stepId?: string;
    message: string;
    code: string;
    stack?: string;
  };
  context: WorkflowContext;
}

/**
 * Backward compatibility alias
 */
export type WorkflowExecutionResult = WorkflowResult;
