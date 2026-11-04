/**
 * Error Recovery & Fault Tolerance Engine
 * Implements exponential backoff retries, fallback routing, and Saga rollback compensation
 */

import { EventEmitter } from 'node:events';
import { WorkflowStep, WorkflowContext } from '../types/workflow.js';
import { RetryPolicy, FallbackAction, CompensationAction } from '../types/error-recovery.js';
import { IToolExecutor, ToolExecutionRequest } from '../types/tool.js';
import { RiskLevel } from '../types/safety.js';

export interface RetryAttemptEvent {
  stepId: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
}

export interface CompensationEvent {
  stepId: string;
  compensationId: string;
  toolName: string;
  success: boolean;
  error?: Error;
}

export class ErrorRecoveryEngine extends EventEmitter {
  /**
   * Executes an asynchronous task with exponential backoff retries based on RetryPolicy
   */
  public async executeWithRetry<T>(
    operation: (attempt: number) => Promise<T>,
    policy: RetryPolicy,
    context: WorkflowContext,
    stepId: string
  ): Promise<T> {
    let lastError: Error = new Error(`Step '${stepId}' failed with unknown error`);
    const maxAttempts = Math.max(1, policy.maxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      context.attemptsPerStep[stepId] = attempt;

      try {
        return await operation(attempt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error code is retryable if restricted
        if (policy.retryableErrorCodes && policy.retryableErrorCodes.length > 0) {
          const errCode = (lastError as { code?: string }).code;
          if (errCode && !policy.retryableErrorCodes.includes(errCode)) {
            context.logs.push({
              timestamp: Date.now(),
              level: 'WARN',
              message: `Step '${stepId}' error code '${errCode}' is not retryable under policy`,
              details: { attempt, lastError: lastError.message },
            });
            throw lastError;
          }
        }

        if (attempt >= maxAttempts) {
          context.logs.push({
            timestamp: Date.now(),
            level: 'ERROR',
            message: `Step '${stepId}' exhausted all ${maxAttempts} retry attempts`,
            details: { lastError: lastError.message },
          });
          break;
        }

        // Calculate exponential backoff delay with jitter
        const baseDelay = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1);
        const maxBackoff = policy.maxBackoffMs ?? 30000;
        const cappedDelay = Math.min(baseDelay, maxBackoff);
        const jitter = Math.floor(Math.random() * (cappedDelay * 0.1)); // 10% jitter
        const totalDelay = cappedDelay + jitter;

        context.logs.push({
          timestamp: Date.now(),
          level: 'INFO',
          message: `Retrying step '${stepId}' (attempt ${attempt + 1}/${maxAttempts}) in ${totalDelay}ms: ${lastError.message}`,
        });

        const retryEvent: RetryAttemptEvent = {
          stepId,
          attempt,
          maxAttempts,
          delayMs: totalDelay,
          error: lastError,
        };
        this.emit('retryAttempt', retryEvent);

        await new Promise((resolve) => setTimeout(resolve, totalDelay));
      }
    }

    throw lastError;
  }

  /**
   * Evaluates and applies fallback actions when retries fail
   */
  public async handleFallback(
    step: WorkflowStep,
    error: Error,
    context: WorkflowContext
  ): Promise<{
    handled: boolean;
    strategy: string;
    nextStepId?: string;
    output?: unknown;
    clarificationPrompt?: string;
  }> {
    const fallback: FallbackAction | undefined = step.fallbackAction;

    if (!fallback) {
      return { handled: false, strategy: 'NONE' };
    }

    context.logs.push({
      timestamp: Date.now(),
      level: 'WARN',
      message: `Executing fallback strategy '${fallback.type}' for step '${step.id}': ${error.message}`,
    });

    switch (fallback.type) {
      case 'ALTERNATIVE_STEP':
        if (!fallback.fallbackStepId) {
          throw new Error(`Fallback for step '${step.id}' specified ALTERNATIVE_STEP but missing 'fallbackStepId'`);
        }
        return {
          handled: true,
          strategy: 'ALTERNATIVE_STEP',
          nextStepId: fallback.fallbackStepId,
        };

      case 'DEFAULT_OUTPUT':
        return {
          handled: true,
          strategy: 'DEFAULT_OUTPUT',
          output: fallback.defaultOutput ?? {},
        };

      case 'ASK_USER':
        return {
          handled: true,
          strategy: 'ASK_USER',
          clarificationPrompt:
            fallback.clarificationPrompt ??
            `I encountered an issue executing step '${step.name}'. Could you please clarify your request?`,
        };

      case 'ABORT':
      default:
        return {
          handled: true,
          strategy: 'ABORT',
        };
    }
  }

  /**
   * Executes compensation actions in reverse order (Saga pattern)
   */
  public async executeCompensations(
    compensations: CompensationAction[],
    context: WorkflowContext,
    executor: IToolExecutor
  ): Promise<void> {
    if (compensations.length === 0) return;

    context.logs.push({
      timestamp: Date.now(),
      level: 'WARN',
      message: `Executing ${compensations.length} compensation rollback action(s)`,
    });

    // Run in reverse order of execution (LIFO)
    const reversed = [...compensations].reverse();

    for (const comp of reversed) {
      try {
        let params: Record<string, unknown>;
        if (typeof comp.parameters === 'function') {
          params = comp.parameters(context);
        } else {
          params = comp.parameters;
        }

        const request: ToolExecutionRequest = {
          requestId: `comp_${Date.now()}_${comp.id}`,
          workflowId: context.workflowId,
          stepId: comp.id,
          toolName: comp.toolName,
          parameters: params,
          riskLevel: RiskLevel.B_LOW_RISK,
        };

        const result = await executor.execute(request);

        if (!result.success) {
          const errMsg = result.error?.message ?? 'Compensation tool execution failed';
          throw new Error(errMsg);
        }

        this.emit('compensationSuccess', {
          stepId: comp.id,
          compensationId: comp.id,
          toolName: comp.toolName,
          success: true,
        });

        context.logs.push({
          timestamp: Date.now(),
          level: 'INFO',
          message: `Compensation action '${comp.id}' (${comp.toolName}) completed successfully`,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit('compensationFailed', {
          stepId: comp.id,
          compensationId: comp.id,
          toolName: comp.toolName,
          success: false,
          error,
        });

        context.logs.push({
          timestamp: Date.now(),
          level: 'ERROR',
          message: `Compensation action '${comp.id}' failed: ${error.message}`,
        });
      }
    }
  }
}
