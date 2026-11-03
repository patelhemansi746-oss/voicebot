/**
 * Mock Tool Executor & Safe Execution Pipeline
 * Enforces allow-listed tools, parameter schema validation, permission scopes,
 * approval guards, timeouts, and cancellation.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

import {
  IToolExecutor,
  ToolSpec,
  ToolExecutionRequest,
  ToolExecutionResult,
  MockToolBehavior,
} from '../types/tool.js';
import { RiskLevel } from '../types/safety.js';
import { ToolRegistry } from './ToolRegistry.js';
import { SafetyGate } from '../safety/SafetyGate.js';

export class MockToolExecutor implements IToolExecutor {
  private registry: ToolRegistry;
  private safetyGate?: SafetyGate;
  private defaultTimeoutMs: number;
  private mockBehaviors: Map<string, MockToolBehavior> = new Map();
  private failureCounters: Map<string, number> = new Map();
  private executionHistory: ToolExecutionResult[] = [];

  constructor(
    registry?: ToolRegistry,
    safetyGate?: SafetyGate,
    defaultTimeoutMs = 30000
  ) {
    this.registry = registry ?? new ToolRegistry(true);
    this.safetyGate = safetyGate;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.setupDefaultMockHandlers();
  }

  public getRegistry(): ToolRegistry {
    return this.registry;
  }

  public setSafetyGate(gate: SafetyGate): void {
    this.safetyGate = gate;
  }

  public getSafetyGate(): SafetyGate | undefined {
    return this.safetyGate;
  }

  public setDefaultTimeoutMs(timeoutMs: number): void {
    this.defaultTimeoutMs = timeoutMs;
  }

  public registerTool(tool: ToolSpec, mockConfig?: MockToolBehavior): void {
    this.registry.register(tool, true);
    if (mockConfig) {
      this.configureMock(tool.name, mockConfig);
    }
  }

  public getTool(toolName: string): ToolSpec | undefined {
    return this.registry.get(toolName);
  }

  public listTools(): ToolSpec[] {
    return this.registry.list();
  }

  public configureMock(toolName: string, behavior: MockToolBehavior): void {
    this.mockBehaviors.set(toolName, { ...behavior });
    if (!this.registry.has(toolName)) {
      this.registry.register(
        {
          name: toolName,
          description: `Mock simulated tool for ${toolName}`,
          purpose: 'Simulation and testing',
          riskLevel: RiskLevel.A_INFORMATIONAL,
          parameters: { type: 'object', properties: {} },
          failureBehavior: 'RETRY',
          isIdempotent: true,
        },
        true
      );
    }
    // Reset failure counter if failNTimes is configured
    if (behavior.failNTimes !== undefined) {
      this.failureCounters.set(toolName, behavior.failNTimes);
    }
  }

  public resetMocks(): void {
    this.mockBehaviors.clear();
    this.failureCounters.clear();
    this.setupDefaultMockHandlers();
  }

  public clearHistory(): void {
    this.executionHistory = [];
  }

  public getExecutionHistory(): ToolExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Executes a tool request through the safe execution pipeline
   */
  public async execute<T = unknown>(request: ToolExecutionRequest): Promise<ToolExecutionResult<T>> {
    const startTime = Date.now();

    // 0. Check cancellation signal immediately
    if (request.signal?.aborted) {
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: {
          code: 'EXECUTION_CANCELLED',
          message:
            typeof request.signal.reason === 'string'
              ? request.signal.reason
              : 'Tool execution was cancelled',
          isRetryable: false,
        },
      };
      this.executionHistory.push(res);
      return res;
    }

    // 1. Tool existence check
    let tool: ToolSpec;
    try {
      tool = this.registry.require(request.toolName);
    } catch (err) {
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: {
          code: 'TOOL_NOT_FOUND',
          message: err instanceof Error ? err.message : String(err),
          isRetryable: false,
        },
      };
      this.executionHistory.push(res);
      return res;
    }

    // 2. Allow-list check
    try {
      this.registry.assertAllowlisted(request.toolName);
    } catch (err) {
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: {
          code: 'TOOL_NOT_ALLOWLISTED',
          message: err instanceof Error ? err.message : String(err),
          isRetryable: false,
        },
      };
      this.executionHistory.push(res);
      return res;
    }

    // 3. Schema Parameter Validation
    try {
      this.registry.validateParameters(request.toolName, request.parameters);
    } catch (err) {
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: {
          code: 'PARAM_VALIDATION_ERROR',
          message: err instanceof Error ? err.message : String(err),
          isRetryable: false,
        },
      };
      this.executionHistory.push(res);
      return res;
    }

    // 4. Permission Scopes Enforcement (enforced when grantedScopes is provided)
    if (request.grantedScopes !== undefined) {
      try {
        this.registry.checkPermissionScopes(request.toolName, request.grantedScopes);
      } catch (err) {
        const res: ToolExecutionResult<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          error: {
            code: 'PERMISSION_SCOPE_DENIED',
            message: err instanceof Error ? err.message : String(err),
            isRetryable: false,
          },
        };
        this.executionHistory.push(res);
        return res;
      }
    }

    // 5. Approval Gate Guard: Rejected or Expired actions NEVER execute!
    if (request.approvalToken && this.safetyGate) {
      try {
        this.safetyGate.assertCanExecute(request.approvalToken);
      } catch (err) {
        const res: ToolExecutionResult<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          error: {
            code: 'ACTION_APPROVAL_BLOCKED',
            message: err instanceof Error ? err.message : String(err),
            isRetryable: false,
          },
        };
        this.executionHistory.push(res);
        return res;
      }
    }

    const mockConfig = this.mockBehaviors.get(request.toolName) ?? {};

    // 6. Explicit Simulated Timeout flag
    if (mockConfig.simulateTimeout) {
      const res: ToolExecutionResult<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        error: {
          code: 'TOOL_TIMEOUT',
          message: `Tool execution '${request.toolName}' exceeded timeout limit`,
          isRetryable: tool.isIdempotent ?? true,
        },
      };
      this.executionHistory.push(res);
      return res;
    }

    // 7. Enforce real timeout wrapper
    const effectiveTimeoutMs =
      request.timeoutMs ?? tool.timeoutMs ?? this.defaultTimeoutMs;

    return this.executeWithTimeout(async () => {
      // 8. Simulate Latency
      if (mockConfig.simulatedLatencyMs) {
        let delay = 0;
        if (typeof mockConfig.simulatedLatencyMs === 'number') {
          delay = mockConfig.simulatedLatencyMs;
        } else {
          const { min, max } = mockConfig.simulatedLatencyMs;
          delay = Math.floor(Math.random() * (max - min + 1)) + min;
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (request.signal?.aborted) {
          const res: ToolExecutionResult<T> = {
            requestId: request.requestId,
            toolName: request.toolName,
            success: false,
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
            error: {
              code: 'EXECUTION_CANCELLED',
              message:
                typeof request.signal.reason === 'string'
                  ? request.signal.reason
                  : 'Tool execution was cancelled',
              isRetryable: false,
            },
          };
          this.executionHistory.push(res);
          return res;
        }
      }

      // 9. Check consecutive fail-N-times simulation
      const remainingFails = this.failureCounters.get(request.toolName);
      if (remainingFails !== undefined && remainingFails > 0) {
        this.failureCounters.set(request.toolName, remainingFails - 1);
        const durationMs = Date.now() - startTime;
        const res: ToolExecutionResult<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs,
          timestamp: Date.now(),
          error: {
            code: mockConfig.failureErrorCode ?? 'SIMULATED_TRANSIENT_ERROR',
            message:
              mockConfig.failureErrorMessage ??
              `Simulated transient failure for tool '${request.toolName}' (${remainingFails} remaining)`,
            isRetryable: tool.isIdempotent ?? true,
          },
        };
        this.executionHistory.push(res);
        return res;
      }

      // 10. Check probabilistic failure rate
      if (mockConfig.failureRate !== undefined && mockConfig.failureRate > 0) {
        if (Math.random() < mockConfig.failureRate) {
          const durationMs = Date.now() - startTime;
          const res: ToolExecutionResult<T> = {
            requestId: request.requestId,
            toolName: request.toolName,
            success: false,
            durationMs,
            timestamp: Date.now(),
            error: {
              code: mockConfig.failureErrorCode ?? 'SIMULATED_PROBABILISTIC_ERROR',
              message:
                mockConfig.failureErrorMessage ??
                `Simulated random failure for tool '${request.toolName}'`,
              isRetryable: tool.isIdempotent ?? true,
            },
          };
          this.executionHistory.push(res);
          return res;
        }
      }

      // 11. Execute mock handler or default behavior
      try {
        let data: unknown;
        if (mockConfig.mockHandler) {
          data = await Promise.resolve(mockConfig.mockHandler(request.parameters));
        } else {
          data = await this.executeDefaultHandler(request.toolName, request.parameters);
        }

        const durationMs = Date.now() - startTime;
        const res: ToolExecutionResult<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: true,
          data: data as T,
          durationMs,
          timestamp: Date.now(),
        };
        this.executionHistory.push(res);
        return res;
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const res: ToolExecutionResult<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs,
          timestamp: Date.now(),
          error: {
            code: 'EXECUTION_EXCEPTION',
            message: err instanceof Error ? err.message : String(err),
            isRetryable: tool.isIdempotent ?? (tool.failureBehavior === 'RETRY'),
          },
        };
        this.executionHistory.push(res);
        return res;
      }
    }, effectiveTimeoutMs, request, startTime, tool);
  }

  /**
   * Wrap an execution with a hard timeout guard
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<ToolExecutionResult<T>>,
    timeoutMs: number,
    request: ToolExecutionRequest,
    startTime: number,
    tool: ToolSpec
  ): Promise<ToolExecutionResult<T>> {
    if (timeoutMs <= 0) {
      return operation();
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<ToolExecutionResult<T>>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          error: {
            code: 'TOOL_TIMEOUT',
            message: `Tool execution '${request.toolName}' timed out after ${timeoutMs}ms limit`,
            isRetryable: tool.isIdempotent ?? true,
          },
        });
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([operation(), timeoutPromise]);
      if (result.error?.code === 'TOOL_TIMEOUT') {
        this.executionHistory.push(result);
      }
      return result;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private setupDefaultMockHandlers(): void {
    this.configureMock('calculator', {
      mockHandler: (params) => {
        const expr = String(params.expression ?? '0');
        try {
          const cleanExpr = expr.replace(/[^0-9+\-*/().]/g, '');
          const result = Function(`"use strict"; return (${cleanExpr})`)();
          return { expression: expr, result };
        } catch {
          return { expression: expr, result: 0 };
        }
      },
    });

    this.configureMock('summarize_text', {
      mockHandler: (params) => {
        const text = String(params.text ?? '');
        const maxPoints = Number(params.maxPoints ?? 3);
        return {
          summary: [
            'Context-aware AI voice co-pilot improves productivity without context switching.',
            'Safety gates classify actions and enforce human-in-the-loop authorization.',
            'Deterministic state machine orchestrates multi-step agentic workflows.',
          ].slice(0, maxPoints),
          sourceLength: text.length,
          compressedRatio: 0.28,
        };
      },
    });
  }

  private async executeDefaultHandler(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return {
      message: `Tool '${toolName}' executed successfully with default mock`,
      params,
    };
  }
}
