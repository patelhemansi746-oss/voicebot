/**
 * Tool & Mock Executor Type Definitions
 * Academia AI Voice Co-Pilot PRD Section 17 & SDD
 */

import { RiskLevel } from './safety.js';

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ToolParameterProperty {
  type: ToolParameterType;
  description: string;
  required?: boolean;
  enum?: string[] | number[];
  default?: unknown;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  purpose: string;
  parameters: ToolParameterSchema;
  riskLevel: RiskLevel;
  requiredPermission?: string;
  requiredScopes?: string[];
  isIdempotent?: boolean;
  timeoutMs?: number;
  failureBehavior: 'RETRY' | 'ABORT' | 'FALLBACK';
}

/**
 * Backward compatibility alias
 */
export type ToolDefinition = ToolSpec;

export interface ToolExecutionRequest {
  requestId: string;
  workflowId: string;
  stepId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  riskLevel: RiskLevel;
  approvalToken?: string;
  timeoutMs?: number;
  grantedScopes?: string[];
  signal?: AbortSignal;
}

export interface ToolExecutionResult<T = unknown> {
  requestId: string;
  toolName: string;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    isRetryable: boolean;
  };
  durationMs: number;
  timestamp: number;
}

/**
 * Mocking configuration for tool simulation
 */
export interface MockToolBehavior {
  /** Simulated latency in milliseconds (supports min/max range) */
  simulatedLatencyMs?: number | { min: number; max: number };
  /** Probability of simulated failure (0.0 - 1.0) */
  failureRate?: number;
  /** Explicit count of consecutive failures before succeeding */
  failNTimes?: number;
  /** Custom error code when simulating failure */
  failureErrorCode?: string;
  /** Custom error message when simulating failure */
  failureErrorMessage?: string;
  /** Canned static response or dynamic generator */
  mockHandler?: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Force timeout behavior */
  simulateTimeout?: boolean;
}

export interface IToolExecutor {
  registerTool(tool: ToolSpec, mockConfig?: MockToolBehavior): void;
  getTool(toolName: string): ToolSpec | undefined;
  listTools(): ToolSpec[];
  execute<T = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<T>>;
  configureMock(toolName: string, behavior: MockToolBehavior): void;
  resetMocks(): void;
  getExecutionHistory(): ToolExecutionResult[];
}
