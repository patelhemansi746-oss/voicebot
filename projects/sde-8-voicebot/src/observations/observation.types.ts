import { SourceReference, ContextItemType } from '../schemas/context.schema';

export interface SourceLinkedObservation {
  /** Unique observation ID */
  id: string;
  /** ISO 8601 timestamp representing exact time of observation creation */
  timestamp: string;
  /** Epoch milliseconds for fast age calculations */
  timestampMs: number;
  /** Complete source reference metadata (origin application, window title, synthetic flag) */
  source: SourceReference;
  /** Type of observation */
  type: ContextItemType;
  /** Sanitized text or structured payload */
  content: string;
  /** Deterministic SHA-256 or digest hash of content and source */
  contentHash: string;
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
  /** Flag indicating whether the observation is synthetic (strictly true for safety) */
  isSynthetic: boolean;
  /** Optional metadata tags */
  metadata?: Record<string, any>;
}

export type ObservationDropReason = 
  | 'ACCEPTED' 
  | 'DROPPED_STALE' 
  | 'DROPPED_DUPLICATE' 
  | 'DROPPED_CONSENT_WITHDRAWN';

export interface ObservationIngestResult {
  accepted: boolean;
  reason: ObservationDropReason;
  observation?: SourceLinkedObservation;
  details?: string;
}

export class ConsentWithdrawnError extends Error {
  constructor(message: string = 'User consent for context capture has been withdrawn. Capture halted and buffers cleared.') {
    super(message);
    this.name = 'ConsentWithdrawnError';
  }
}

export class StaleObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleObservationError';
  }
}

export class DuplicateObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateObservationError';
  }
}
