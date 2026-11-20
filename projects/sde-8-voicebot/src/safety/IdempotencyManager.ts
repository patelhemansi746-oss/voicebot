/**
 * Idempotency Manager
 * Tracks execution of tools using idempotency keys.
 * Ensures duplicate calls with identical keys return cached results and NEVER re-execute the underlying tool.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { IdempotencyRecord } from '../types/idempotency.js';

export class IdempotencyManager extends EventEmitter {
  private records: Map<string, IdempotencyRecord> = new Map();

  /**
   * Deterministically hash parameters object regardless of key insertion order
   */
  public hashParameters(params: Record<string, unknown>): string {
    const sortedKeys = Object.keys(params).sort();
    const normalizedObj: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      normalizedObj[key] = params[key];
    }
    const jsonStr = JSON.stringify(normalizedObj);
    return crypto.createHash('sha256').update(jsonStr).digest('hex').slice(0, 16);
  }

  /**
   * Compute a deterministic idempotency key
   */
  public computeKey(
    toolName: string,
    params: Record<string, unknown>,
    context?: { workflowId?: string; stepId?: string; callerKey?: string }
  ): string {
    if (context?.callerKey) {
      return context.callerKey;
    }
    const wf = context?.workflowId ?? 'wf';
    const step = context?.stepId ?? 'step';
    const paramHash = this.hashParameters(params);
    return `${wf}:${step}:${toolName}:${paramHash}`;
  }

  public has(key: string): boolean {
    return this.records.has(key);
  }

  public get(key: string): IdempotencyRecord | undefined {
    return this.records.get(key);
  }

  public list(): IdempotencyRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Record a tool execution result under an idempotency key
   */
  public recordResult(
    key: string,
    toolName: string,
    parameters: Record<string, unknown>,
    result: unknown,
    context?: { workflowId?: string; stepId?: string }
  ): IdempotencyRecord {
    const record: IdempotencyRecord = {
      key,
      toolName,
      stepId: context?.stepId,
      workflowId: context?.workflowId,
      parameters,
      result,
      timestamp: Date.now(),
      executionCount: 1,
    };
    this.records.set(key, record);
    this.emit('idempotencyRecorded', record);
    return record;
  }

  /**
   * Execute an operation guarded by an idempotency key.
   * If key was previously executed, returns cached result without running executorFn.
   */
  public async executeWithIdempotency<T>(
    key: string,
    toolName: string,
    parameters: Record<string, unknown>,
    executorFn: () => Promise<T>,
    context?: { workflowId?: string; stepId?: string }
  ): Promise<{ result: T; cached: boolean }> {
    const existing = this.records.get(key);
    if (existing) {
      existing.executionCount++;
      this.emit('idempotencyHit', { key, record: existing });
      return {
        result: existing.result as T,
        cached: true,
      };
    }

    // First time executing: run the actual tool function
    const result = await executorFn();
    this.recordResult(key, toolName, parameters, result, context);
    return {
      result,
      cached: false,
    };
  }

  public clear(workflowId?: string): void {
    if (!workflowId) {
      this.records.clear();
      return;
    }
    for (const [key, record] of this.records.entries()) {
      if (record.workflowId === workflowId) {
        this.records.delete(key);
      }
    }
  }
}
