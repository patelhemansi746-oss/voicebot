/**
 * Audit Trail Engine
 * Immutable, append-only step-level audit trail with SHA-256 cryptographic hash chaining.
 * Guarantees observable, verifiable, and tamper-evident workflow execution history.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  AuditRecord,
  AuditEventType,
  AuditActor,
  AuditVerificationResult,
} from '../types/audit.js';

export class AuditTrail extends EventEmitter {
  private records: AuditRecord[] = [];
  private currentSequence = 0;
  private lastHash: string;

  constructor() {
    super();
    this.lastHash = crypto.createHash('sha256').update('ACADEMIA_VOICEBOT_GENESIS').digest('hex');
  }

  /**
   * Compute deterministic SHA-256 hash for an audit record
   */
  private computeRecordHash(
    previousHash: string,
    seq: number,
    timestamp: number,
    workflowId: string,
    eventType: string,
    details: Record<string, unknown>
  ): string {
    const payload = `${previousHash}:${seq}:${timestamp}:${workflowId}:${eventType}:${JSON.stringify(details)}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Append a new audit record to the chain
   */
  public recordEvent(
    eventType: AuditEventType,
    workflowId: string,
    executionId: string,
    details: Record<string, unknown> = {},
    options?: {
      stepId?: string;
      stepName?: string;
      actor?: AuditActor;
      timestamp?: number;
    }
  ): AuditRecord {
    this.currentSequence++;
    const now = options?.timestamp ?? Date.now();
    const recordId = `aud_${workflowId}_${this.currentSequence}_${now}`;

    const actor: AuditActor = options?.actor ?? {
      type: 'SYSTEM',
      id: 'system_workflow_engine',
      name: 'Agentic Workflow Engine',
    };

    const hash = this.computeRecordHash(
      this.lastHash,
      this.currentSequence,
      now,
      workflowId,
      eventType,
      details
    );

    const record: AuditRecord = {
      recordId,
      sequenceNumber: this.currentSequence,
      timestamp: now,
      isoTimestamp: new Date(now).toISOString(),
      workflowId,
      executionId,
      stepId: options?.stepId,
      stepName: options?.stepName,
      eventType,
      actor,
      details,
      previousHash: this.lastHash,
      hash,
    };

    this.lastHash = hash;
    this.records.push(record);
    this.emit('auditRecord', record);
    return record;
  }

  /**
   * Retrieve all audit records, optionally filtered by workflow ID
   */
  public getRecords(workflowId?: string): AuditRecord[] {
    if (!workflowId) return [...this.records];
    return this.records.filter((r) => r.workflowId === workflowId);
  }

  /**
   * Retrieve audit records for a specific step
   */
  public getRecordsByStep(stepId: string): AuditRecord[] {
    return this.records.filter((r) => r.stepId === stepId);
  }

  /**
   * Retrieve audit records by event type
   */
  public getRecordsByEventType(eventType: AuditEventType): AuditRecord[] {
    return this.records.filter((r) => r.eventType === eventType);
  }

  /**
   * Verify the cryptographic hash chain integrity
   */
  public verifyIntegrity(): AuditVerificationResult {
    let expectedPrevious = crypto
      .createHash('sha256')
      .update('ACADEMIA_VOICEBOT_GENESIS')
      .digest('hex');

    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i];
      if (!record) continue;

      // Check previousHash pointer
      if (record.previousHash !== expectedPrevious) {
        return {
          valid: false,
          totalRecords: this.records.length,
          tamperedRecordId: record.recordId,
          error: `Broken hash chain at sequence ${record.sequenceNumber}: previousHash mismatch`,
        };
      }

      // Recompute record hash
      const computedHash = this.computeRecordHash(
        record.previousHash,
        record.sequenceNumber,
        record.timestamp,
        record.workflowId,
        record.eventType,
        record.details
      );

      if (computedHash !== record.hash) {
        return {
          valid: false,
          totalRecords: this.records.length,
          tamperedRecordId: record.recordId,
          error: `Tampered record detected at sequence ${record.sequenceNumber}: hash mismatch`,
        };
      }

      expectedPrevious = record.hash;
    }

    return {
      valid: true,
      totalRecords: this.records.length,
    };
  }

  /**
   * Export audit log as formatted JSON
   */
  public exportJson(): string {
    return JSON.stringify(this.records, null, 2);
  }

  /**
   * Clear records (useful for test resets)
   */
  public clear(workflowId?: string): void {
    if (!workflowId) {
      this.records = [];
      this.currentSequence = 0;
      this.lastHash = crypto
        .createHash('sha256')
        .update('ACADEMIA_VOICEBOT_GENESIS')
        .digest('hex');
      return;
    }
    this.records = this.records.filter((r) => r.workflowId !== workflowId);
  }
}
