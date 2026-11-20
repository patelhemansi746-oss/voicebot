/**
 * Safe Executor
 * Unified execution engine enforcing plan validation, allow-listed tool registry,
 * permission scopes, approval gates, hard timeouts, bounded retries for idempotent calls only,
 * and cancellation.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

import { EventEmitter } from 'node:events';
import {
  WorkflowPlan,
  WorkflowResult,
  WorkflowContext,
  RiskLevel,
} from '../types/index.js';
import {
  ToolExecutionRequest,
  ToolExecutionResult,
} from '../types/tool.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import { ApprovalManager, ActionExecutionBlockedError } from '../safety/ApprovalManager.js';
import { PlanValidator } from '../validation/PlanValidator.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { WorkflowOrchestrator } from './WorkflowOrchestrator.js';
import { RetryPolicy } from '../types/error-recovery.js';

export interface SafeExecutorConfig {
  defaultTimeoutMs?: number;
  maxBoundedRetries?: number;
  autoValidatePlan?: boolean;
}

export class SafeExecutor extends EventEmitter {
  private toolRegistry: ToolRegistry;
  private safetyGate: SafetyGate;
  private approvalManager: ApprovalManager;
  private planValidator: PlanValidator;
  private mockExecutor: MockToolExecutor;
  private defaultTimeoutMs: number;
  private maxBoundedRetries: number;
  private autoValidatePlan: boolean;
  private activeControllers: Map<string, AbortController> = new Map();

  constructor(
    toolRegistry?: ToolRegistry,
    safetyGate?: SafetyGate,
    config?: SafeExecutorConfig
  ) {
    super();
    this.toolRegistry = toolRegistry ?? new ToolRegistry(true);
    this.safetyGate = safetyGate ?? new SafetyGate();
    this.approvalManager = this.safetyGate.getApprovalManager();
    this.planValidator = new PlanValidator(this.toolRegistry);
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? 30000;
    this.maxBoundedRetries = config?.maxBoundedRetries ?? 3;
    this.autoValidatePlan = config?.autoValidatePlan ?? true;

    this.mockExecutor = new MockToolExecutor(
      this.toolRegistry,
      this.safetyGate,
      this.defaultTimeoutMs
    );
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getSafetyGate(): SafetyGate {
    return this.safetyGate;
  }

  public getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  public getPlanValidator(): PlanValidator {
    return this.planValidator;
  }

  public getMockExecutor(): MockToolExecutor {
    return this.mockExecutor;
  }

  /**
   * Cancel execution for a specific workflow or execution ID
   */
  public cancel(executionId: string, reason = 'Execution cancelled by user'): void {
    const controller = this.activeControllers.get(executionId);
    if (controller) {
      controller.abort(reason);
      this.activeControllers.delete(executionId);
      this.emit('executionCancelled', { executionId, reason });
    }
  }

  /**
   * Execute a single tool safely with all policy gates enforced:
   * 1. Allow-list check
   * 2. Schema parameter validation
   * 3. Permission scopes check
   * 4. Approval check (rejected or expired actions NEVER run)
   * 5. Timeout
   * 6. Bounded retries for idempotent calls ONLY
   */
  public async executeTool<T = unknown>(
    request: ToolExecutionRequest,
    options?: {
      retryPolicy?: RetryPolicy;
      isIdempotent?: boolean;
    }
  ): Promise<ToolExecutionResult<T>> {
    const startTime = Date.now();
    const controller = new AbortController();
    this.activeControllers.set(request.requestId, controller);

    if (request.signal) {
      request.signal.addEventListener('abort', () => {
        controller.abort(request.signal?.reason);
      });
    }

    try {
      // 1. Tool check & Allow-list
      this.toolRegistry.assertAllowlisted(request.toolName);
      const tool = this.toolRegistry.require(request.toolName);

      // 2. Schema Parameter validation
      this.toolRegistry.validateParameters(request.toolName, request.parameters);

      // 3. Permission Scopes enforcement
      if (request.grantedScopes !== undefined) {
        this.toolRegistry.checkPermissionScopes(request.toolName, request.grantedScopes);
      }

      // 4. Approval Invariant Check: A rejected or expired action NEVER executes!
      if (request.approvalToken) {
        this.approvalManager.assertCanExecute(request.approvalToken);
      }

      // 5. Determine idempotency
      const isIdempotent =
        options?.isIdempotent ??
        tool.isIdempotent ??
        (tool.riskLevel === RiskLevel.A_INFORMATIONAL);

      const effectiveRetryPolicy = options?.retryPolicy;

      // 6. Execute with or without retries based on idempotency
      if (effectiveRetryPolicy && isIdempotent) {
        return await this.executeWithBoundedRetry<T>(
          request,
          effectiveRetryPolicy,
          controller.signal
        );
      } else {
        // Non-idempotent calls: retries strictly forbidden to prevent duplicate side-effects
        return await this.mockExecutor.execute<T>({
          ...request,
          signal: controller.signal,
        });
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const isBlocked = err instanceof ActionExecutionBlockedError;
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs,
        timestamp: Date.now(),
        error: {
          code: isBlocked ? 'ACTION_APPROVAL_BLOCKED' : 'EXECUTION_REJECTED',
          message: err instanceof Error ? err.message : String(err),
          isRetryable: false,
        },
      };
      return res;
    } finally {
      this.activeControllers.delete(request.requestId);
    }
  }

  /**
   * Execute with bounded retries (ONLY for idempotent operations)
   */
  private async executeWithBoundedRetry<T>(
    request: ToolExecutionRequest,
    policy: RetryPolicy,
    signal: AbortSignal
  ): Promise<ToolExecutionResult<T>> {
    const maxAttempts = Math.min(policy.maxAttempts, this.maxBoundedRetries);
    let lastResult: ToolExecutionResult<T> | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) {
        return {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs: 0,
          timestamp: Date.now(),
          error: {
            code: 'EXECUTION_CANCELLED',
            message: typeof signal.reason === 'string' ? signal.reason : 'Execution cancelled',
            isRetryable: false,
          },
        };
      }

      const result = await this.mockExecutor.execute<T>({
        ...request,
        signal,
      });

      if (result.success) {
        return result;
      }

      lastResult = result;

      if (!result.error?.isRetryable) {
        break;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(
          policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1),
          policy.maxBackoffMs ?? 5000
        );
        this.emit('retryScheduled', {
          toolName: request.toolName,
          attempt,
          maxAttempts,
          delayMs: delay,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return (
      lastResult ?? {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: 0,
        timestamp: Date.now(),
        error: {
          code: 'RETRIES_EXHAUSTED',
          message: `Tool '${request.toolName}' exhausted ${maxAttempts} bounded retry attempts`,
          isRetryable: false,
        },
      }
    );
  }

  /**
   * Execute a full WorkflowPlan with validation, approvals, and safe orchestration
   */
  public async executePlan(
    plan: WorkflowPlan,
    context: WorkflowContext
  ): Promise<WorkflowResult> {
    // 1. Mandatory plan validation
    if (this.autoValidatePlan) {
      const validation = this.planValidator.validate(plan);
      if (!validation.isValid) {
        const errors = validation.errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
        return {
          workflowId: context.workflowId,
          finalState: 'FAILED' as any,
          success: false,
          startTime: Date.now(),
          endTime: Date.now(),
          durationMs: 0,
          executedSteps: [],
          outputs: {},
          error: {
            code: 'PLAN_VALIDATION_ERROR',
            message: `Plan rejected by PlanValidator: ${errors}`,
          },
          context,
        };
      }
    }

    // 2. Delegate to WorkflowOrchestrator
    const orchestrator = new WorkflowOrchestrator(
      this.mockExecutor,
      this.safetyGate,
      undefined,
      this.planValidator
    );

    this.activeControllers.set(context.workflowId, (orchestrator as any).abortController);

    try {
      return await orchestrator.executeWorkflow(plan, context);
    } finally {
      this.activeControllers.delete(context.workflowId);
    }
  }
}
