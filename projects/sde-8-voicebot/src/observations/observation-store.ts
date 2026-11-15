import * as crypto from 'crypto';
import { SourceReference, ContextItem } from '../schemas/context.schema';
import { FramePayload } from '../capture/capture.adapter';
import {
  SourceLinkedObservation,
  ObservationIngestResult,
  ConsentWithdrawnError
} from './observation.types';

export interface ObservationStoreConfig {
  /** Maximum duration before an observation is deemed stale in ms (default: 300,000ms / 5 min) */
  staleTtlMs?: number;
  /** Whether consent is granted initially (default: false - opt-in required) */
  initialConsent?: boolean;
}

/**
 * ObservationStore (Week 3 - Days 15–16)
 * 
 * Enforces:
 * 1. Timestamped & Source-linked observations: Every ingested item carries verified SourceReference.
 * 2. Stale frame handling: Automatically drops frames older than staleTtlMs.
 * 3. Duplicate frame handling: Computes cryptographic content hashes and drops duplicate frames.
 * 4. Consent withdrawal: Revoking consent halts capture and immediately clears all pending context buffers.
 */
export class ObservationStore {
  private observations: SourceLinkedObservation[] = [];
  private seenContentHashes: Set<string> = new Set();
  private staleTtlMs: number;
  private consentGranted: boolean;
  private droppedStaleCount: number = 0;
  private droppedDuplicateCount: number = 0;

  constructor(config?: ObservationStoreConfig) {
    this.staleTtlMs = config?.staleTtlMs ?? 300_000;
    this.consentGranted = config?.initialConsent ?? false;
  }

  /**
   * Generates a deterministic SHA-256 hash from source metadata and content.
   */
  public computeHash(source: SourceReference, content: string): string {
    const raw = `${source.application}::${source.windowTitle || ''}::${content.trim()}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Returns current consent status.
   */
  public isConsentGranted(): boolean {
    return this.consentGranted;
  }

  /**
   * Grants user consent for context capture.
   */
  public grantConsent(): void {
    this.consentGranted = true;
  }

  /**
   * Revokes user consent.
   * Acceptance Criterion: Withdrawing consent stops capture and immediately clears pending context.
   */
  public withdrawConsent(): void {
    this.consentGranted = false;
    this.clear();
  }

  /**
   * Clears all in-memory observations and cached content hashes.
   */
  public clear(): void {
    this.observations = [];
    this.seenContentHashes.clear();
  }

  /**
   * Ingests a raw FramePayload or ContextItem into a source-linked observation.
   */
  public ingestFrame(frame: FramePayload, now: number = Date.now()): ObservationIngestResult {
    const source: SourceReference = {
      application: frame.application,
      windowTitle: frame.windowTitle || '',
      capturedAt: new Date(frame.timestamp || now).toISOString(),
      isSynthetic: frame.isSynthetic ?? true
    };

    return this.ingestRaw(
      frame.ocrContent || '',
      source,
      'screen_ocr',
      frame.timestamp || now,
      now,
      frame.metadata
    );
  }

  /**
   * Ingests a ContextItem into a source-linked observation.
   */
  public ingestContextItem(item: ContextItem, now: number = Date.now()): ObservationIngestResult {
    const timeMs = item.source?.capturedAt 
      ? (typeof item.source.capturedAt === 'string' ? Date.parse(item.source.capturedAt) : Number(item.source.capturedAt))
      : now;

    return this.ingestRaw(
      item.content,
      item.source,
      item.type,
      isNaN(timeMs) ? now : timeMs,
      now,
      item.metadata
    );
  }

  /**
   * Core ingest pipeline implementing consent check, stale drop, and duplicate drop.
   */
  public ingestRaw(
    content: string,
    source: SourceReference,
    type: SourceLinkedObservation['type'] = 'screen_ocr',
    itemTimestampMs: number = Date.now(),
    referenceNow: number = Date.now(),
    metadata?: Record<string, any>
  ): ObservationIngestResult {
    // 1. Consent Gate: If consent is withdrawn, drop immediately
    if (!this.consentGranted) {
      return {
        accepted: false,
        reason: 'DROPPED_CONSENT_WITHDRAWN',
        details: 'User consent has been withdrawn or was not granted. Capture halted.'
      };
    }

    // 2. Stale Frame Check
    const ageMs = referenceNow - itemTimestampMs;
    if (ageMs > this.staleTtlMs) {
      this.droppedStaleCount++;
      return {
        accepted: false,
        reason: 'DROPPED_STALE',
        details: `Frame age of ${ageMs}ms exceeds stale TTL threshold of ${this.staleTtlMs}ms.`
      };
    }

    // 3. Duplicate Frame Check
    const contentHash = this.computeHash(source, content);
    if (this.seenContentHashes.has(contentHash)) {
      this.droppedDuplicateCount++;
      return {
        accepted: false,
        reason: 'DROPPED_DUPLICATE',
        details: `Duplicate frame detected matching content hash: ${contentHash.substring(0, 8)}...`
      };
    }

    // 4. Create and store Timestamped & Source-Linked Observation
    const observation: SourceLinkedObservation = {
      id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(itemTimestampMs).toISOString(),
      timestampMs: itemTimestampMs,
      source: {
        ...source,
        capturedAt: source.capturedAt || new Date(itemTimestampMs).toISOString(),
        isSynthetic: true // Safety guarantee
      },
      type,
      content,
      contentHash,
      confidence: 1.0,
      isSynthetic: true,
      metadata
    };

    this.observations.push(observation);
    this.seenContentHashes.add(contentHash);

    return {
      accepted: true,
      reason: 'ACCEPTED',
      observation
    };
  }

  /**
   * Returns active, non-stale observations.
   */
  public getObservations(referenceNow: number = Date.now()): SourceLinkedObservation[] {
    if (!this.consentGranted) {
      return [];
    }

    // Filter out items that have aged past stale TTL since ingest
    return this.observations.filter(obs => {
      const ageMs = referenceNow - obs.timestampMs;
      return ageMs <= this.staleTtlMs;
    });
  }

  public getObservationById(id: string): SourceLinkedObservation | undefined {
    return this.observations.find(o => o.id === id);
  }

  public getObservationCount(): number {
    return this.observations.length;
  }

  public getDroppedStaleCount(): number {
    return this.droppedStaleCount;
  }

  public getDroppedDuplicateCount(): number {
    return this.droppedDuplicateCount;
  }
}
