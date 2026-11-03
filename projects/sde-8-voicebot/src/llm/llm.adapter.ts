import { z } from 'zod';
import { ReasoningResult, ReasoningResultSchema } from '../schemas/reasoning.schema';

export interface LlmExecutionOptions {
  /** Timeout per invocation attempt in milliseconds (default: 3000ms) */
  timeoutMs?: number;
  /** Maximum number of retry attempts on transient failure (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms before first retry (default: 50ms) */
  initialBackoffMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Sampling temperature */
  temperature?: number;
}

export interface LlmExecutionMetadata {
  attempts: number;
  totalDurationMs: number;
  modelUsed: string;
  isMock: boolean;
}

export interface LlmResponse<T> {
  data: T;
  rawText: string;
  metadata: LlmExecutionMetadata;
}

// =========================================================================
// Error Definitions
// =========================================================================
export class LlmError extends Error {
  public isTransient: boolean;
  constructor(message: string, isTransient: boolean = false) {
    super(message);
    this.name = 'LlmError';
    this.isTransient = isTransient;
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms.`, true);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmRateLimitError extends LlmError {
  constructor(message: string = 'LLM rate limit / quota exceeded (HTTP 429).') {
    super(message, true);
    this.name = 'LlmRateLimitError';
  }
}

export class LlmMalformedOutputError extends LlmError {
  public rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(`LLM returned malformed non-JSON output: ${message}`, false);
    this.name = 'LlmMalformedOutputError';
    this.rawOutput = rawOutput;
  }
}

export class LlmValidationError extends LlmError {
  public zodErrors: z.ZodIssue[];
  public rawParsed: any;
  constructor(message: string, zodErrors: z.ZodIssue[], rawParsed: any) {
    super(`LLM structured output failed schema validation: ${message}`, false);
    this.name = 'LlmValidationError';
    this.zodErrors = zodErrors;
    this.rawParsed = rawParsed;
  }
}

/**
 * Formal LLM Client Adapter Interface (Week 2 - Days 12–13)
 */
export interface ILlmClientAdapter {
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: LlmExecutionOptions
  ): Promise<LlmResponse<T>>;
}

export interface MockLlmFaultInjectionConfig {
  /** Force all calls to exceed timeout */
  injectTimeout?: boolean;
  /** Force model to return malformed / truncated raw JSON text */
  injectMalformedJson?: boolean;
  /** Force model to return valid JSON but violating the Zod schema */
  injectSchemaViolation?: boolean;
  /** Fail with transient error for the first N attempts, then succeed */
  injectTransientFailures?: number;
  /** Simulated latency per attempt in ms */
  simulatedLatencyMs?: number;
}

/**
 * MockLlmAdapter (Default implementation - offline, zero paid API keys)
 * 
 * Provides:
 * 1. Resilient execution loop with configurable timeout and exponential backoff retry.
 * 2. Strict structured-output validation via Zod schemas.
 * 3. Diagnostic fault-injection hooks for malformed-output and timeout unit tests.
 */
export class MockLlmAdapter implements ILlmClientAdapter {
  private faultConfig: MockLlmFaultInjectionConfig;
  private transientFailureCounter: number = 0;

  constructor(faultConfig?: MockLlmFaultInjectionConfig) {
    this.faultConfig = faultConfig ?? {};
  }

  public setFaultConfig(config: MockLlmFaultInjectionConfig): void {
    this.faultConfig = config;
    this.transientFailureCounter = 0;
  }

  public resetFaults(): void {
    this.faultConfig = {};
    this.transientFailureCounter = 0;
  }

  /**
   * Executes structured generation with timeout, retry, and schema validation.
   */
  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: LlmExecutionOptions
  ): Promise<LlmResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? 3000;
    const maxRetries = options?.maxRetries ?? 3;
    const initialBackoffMs = options?.initialBackoffMs ?? 50;
    const backoffMultiplier = options?.backoffMultiplier ?? 2;

    const startTime = Date.now();
    let attempt = 0;
    let lastError: any = null;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const rawOutput = await this.executeSingleAttempt(prompt, timeoutMs);
        
        // Step 1: Parse JSON text
        let jsonPayload: any;
        try {
          jsonPayload = JSON.parse(rawOutput);
        } catch (parseErr: any) {
          throw new LlmMalformedOutputError(parseErr.message, rawOutput);
        }

        // Step 2: Validate against Zod schema
        const parseResult = schema.safeParse(jsonPayload);
        if (!parseResult.success) {
          throw new LlmValidationError(
            parseResult.error.message,
            parseResult.error.issues,
            jsonPayload
          );
        }

        const totalDurationMs = Date.now() - startTime;
        return {
          data: parseResult.data,
          rawText: rawOutput,
          metadata: {
            attempts: attempt,
            totalDurationMs,
            modelUsed: 'mock-academic-reasoner-v2',
            isMock: true
          }
        };
      } catch (err: any) {
        lastError = err;

        // If the error is non-transient (e.g. malformed output or schema violation), do not retry
        if (err instanceof LlmMalformedOutputError || err instanceof LlmValidationError) {
          throw err;
        }

        // Check if retryable transient error
        const isTransient = (err instanceof LlmError && err.isTransient) || err.name === 'LlmTimeoutError';
        if (!isTransient || attempt > maxRetries) {
          throw err;
        }

        // Exponential backoff delay
        const delay = initialBackoffMs * Math.pow(backoffMultiplier, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
      }
    }

    throw lastError;
  }

  /**
   * Performs a single generation attempt bound by timeout and simulated latency.
   */
  private async executeSingleAttempt(prompt: string, timeoutMs: number): Promise<string> {
    const latency = this.faultConfig.simulatedLatencyMs ?? 20;

    return new Promise<string>((resolve, reject) => {
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new LlmTimeoutError(timeoutMs));
        }
      }, timeoutMs);

      setTimeout(() => {
        if (completed) return;

        // Check timeout injection
        if (this.faultConfig.injectTimeout) {
          // Do nothing; let the timer fire and reject with LlmTimeoutError
          return;
        }

        // Check transient failure injection
        if (this.faultConfig.injectTransientFailures && 
            this.transientFailureCounter < this.faultConfig.injectTransientFailures) {
          this.transientFailureCounter++;
          clearTimeout(timer);
          completed = true;
          reject(new LlmRateLimitError(`Injected transient rate-limit error (attempt ${this.transientFailureCounter})`));
          return;
        }

        // Check malformed JSON injection
        if (this.faultConfig.injectMalformedJson) {
          clearTimeout(timer);
          completed = true;
          resolve('<<<MALFORMED_OUTPUT>>>: { "error": "Unclosed string literal, status: incomplete');
          return;
        }

        // Check schema violation injection
        if (this.faultConfig.injectSchemaViolation) {
          clearTimeout(timer);
          completed = true;
          // Valid JSON, but missing required fields according to ReasoningResultSchema
          resolve(JSON.stringify({
            foo: 'bar',
            arbitraryField: 123
          }));
          return;
        }

        // Normal successful generation conforming to ReasoningResult
        clearTimeout(timer);
        completed = true;
        const result = this.synthesizeReasoningResult(prompt);
        resolve(JSON.stringify(result));
      }, latency);
    });
  }

  /**
   * Offline deterministic generation of structured reasoning results based on prompt context.
   */
  private synthesizeReasoningResult(prompt: string): ReasoningResult {
    const lower = prompt.toLowerCase();
    const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Controlled Action: Level D (Destructive)
    if (lower.includes('delete') || lower.includes('remove') || lower.includes('rm -rf') || lower.includes('drop table')) {
      return {
        requestId,
        sessionId: 'sess-default',
        status: 'pending_approval',
        intent: 'CONTROLLED_ACTION',
        riskLevel: 'D',
        requiresApproval: true,
        toolCall: {
          toolName: 'fs_delete',
          parameters: { target: './temp_cache', recursive: true },
          riskLevel: 'D',
          requiresApproval: true,
          description: 'Delete directory ./temp_cache'
        },
        reasoningText: 'Identified request to delete target files/directories. PRD Section 17/19 requires Level D human confirmation before proceeding.',
        sourcesUsed: ['synth-frame-act-003'],
        executionDurationMs: 45
      };
    }

    // Controlled Action: Level C (File Move / Reorganize)
    if (lower.includes('move') || lower.includes('organize') || lower.includes('rename') || lower.includes('archive')) {
      return {
        requestId,
        sessionId: 'sess-default',
        status: 'pending_approval',
        intent: 'CONTROLLED_ACTION',
        riskLevel: 'C',
        requiresApproval: true,
        toolCall: {
          toolName: 'fs_move',
          parameters: { source: 'research_draft.pdf', destination: './archive/research_draft.pdf' },
          riskLevel: 'C',
          requiresApproval: true,
          description: 'Move file research_draft.pdf to ./archive/'
        },
        reasoningText: 'Detected request to reorganize workspace files. PRD Section 17 requires explicit user approval (Level C) prior to filesystem mutation.',
        sourcesUsed: ['synth-frame-act-003'],
        executionDurationMs: 40
      };
    }

    // Date / Time Query
    if (lower.includes('time') || lower.includes('date') || lower.includes('today') || lower.includes('what day')) {
      const now = new Date();
      return {
        requestId,
        sessionId: 'sess-default',
        status: 'completed',
        intent: 'GENERAL_QUERY',
        riskLevel: 'A',
        requiresApproval: false,
        toolCall: null,
        reasoningText: `The current date and time is ${now.toUTCString()} (ISO: ${now.toISOString()}).`,
        sourcesUsed: [],
        executionDurationMs: 15
      };
    }

    // Academic Research Methodology
    if (lower.includes('method') || lower.includes('sample size') || lower.includes('literature') || lower.includes('pdf')) {
      return {
        requestId,
        sessionId: 'sess-default',
        status: 'completed',
        intent: 'RESEARCH_ASSISTANCE',
        riskLevel: 'A',
        requiresApproval: false,
        toolCall: null,
        reasoningText: 'The active methodology section outlines a quasi-experimental design with N=124 undergraduate participants across two cohorts.',
        sourcesUsed: ['synth-frame-res-002'],
        executionDurationMs: 50
      };
    }

    // Default: Developer Error Explanation
    return {
      requestId,
      sessionId: 'sess-default',
      status: 'completed',
      intent: 'EXPLAIN_ERROR',
      riskLevel: 'A',
      requiresApproval: false,
      toolCall: null,
      reasoningText: 'The runtime failure is caused by attempting to access `.token` on an undefined session object. Apply defensive null checks or optional chaining.',
      sourcesUsed: ['synth-frame-dev-001'],
      executionDurationMs: 55
    };
  }
}
