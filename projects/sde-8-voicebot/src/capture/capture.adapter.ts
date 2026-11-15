import { SYNTHETIC_FRAMES, getSyntheticFrameByKey, SyntheticFrameDefinition } from '../core/synthetic-frames';

export interface FrameDimension {
  width: number;
  height: number;
}

export interface FramePayload {
  frameId: string;
  timestamp: number;
  width: number;
  height: number;
  byteSize: number;
  isSynthetic: boolean;
  application: string;
  windowTitle: string;
  ocrContent: string;
  metadata?: Record<string, any>;
}

export interface OptInCaptureConfig {
  minSamplingIntervalMs?: number;
  maxDimension?: FrameDimension;
  maxByteSize?: number;
}

export class CaptureNotOptedInError extends Error {
  constructor(message: string = 'Screen capture is opt-in and currently disabled. Explicit user consent required.') {
    super(message);
    this.name = 'CaptureNotOptedInError';
  }
}

export class RealScreenshotNotAllowedError extends Error {
  constructor(message: string = 'Real screen capture is prohibited. Week 1/2 spec permits synthetic frames only.') {
    super(message);
    this.name = 'RealScreenshotNotAllowedError';
  }
}

export class SamplingRateExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamplingRateExceededError';
  }
}

export class FrameSizeExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameSizeExceededError';
  }
}

export class FrameDimensionExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameDimensionExceededError';
  }
}

/**
 * OptInCaptureAdapter (Week 2 - Days 8–9)
 * 
 * Enforces:
 * 1. Opt-in only: Capture is strictly OFF by default until explicit opt-in.
 * 2. Sampling rate limits: Enforces minimum interval between frame acquisitions.
 * 3. Size and dimension limits: Rejects oversized frame payloads.
 * 4. Synthetic frames only: Prohibits real screenshot ingestion.
 */
export class OptInCaptureAdapter {
  private optedIn: boolean = false;
  private lastCaptureTimestamp: number = 0;
  private minSamplingIntervalMs: number;
  private maxDimension: FrameDimension;
  private maxByteSize: number;

  constructor(config?: OptInCaptureConfig) {
    this.minSamplingIntervalMs = config?.minSamplingIntervalMs ?? 500;
    this.maxDimension = config?.maxDimension ?? { width: 1920, height: 1080 };
    this.maxByteSize = config?.maxByteSize ?? 2 * 1024 * 1024; // 2MB default
  }

  /**
   * Returns whether the user has explicitly opted into screen capture.
   * Strictly false by default.
   */
  public isOptedIn(): boolean {
    return this.optedIn;
  }

  /**
   * Explicit user opt-in for synthetic frame capture.
   */
  public optIn(): void {
    this.optedIn = true;
  }

  /**
   * Disables frame capture.
   */
  public optOut(): void {
    this.optedIn = false;
  }

  /**
   * Ingests and bounds a frame payload against all security and resource constraints.
   */
  public capture(candidate: FramePayload): FramePayload {
    // 1. Consent Gate: Capture must be opt-in
    if (!this.optedIn) {
      throw new CaptureNotOptedInError();
    }

    // 2. Synthetic Gate: No real screenshots allowed
    if (candidate.isSynthetic !== true) {
      throw new RealScreenshotNotAllowedError();
    }

    // 3. Dimension Limit Gate
    if (candidate.width > this.maxDimension.width || candidate.height > this.maxDimension.height) {
      throw new FrameDimensionExceededError(
        `Frame dimensions ${candidate.width}x${candidate.height} exceed maximum allowed ${this.maxDimension.width}x${this.maxDimension.height}.`
      );
    }

    // 4. Byte Size Limit Gate
    if (candidate.byteSize > this.maxByteSize) {
      throw new FrameSizeExceededError(
        `Frame byte size ${candidate.byteSize} exceeds maximum allowed ${this.maxByteSize} bytes.`
      );
    }

    // 5. Sampling Rate Limiter Gate
    const now = Date.now();
    const elapsed = now - this.lastCaptureTimestamp;
    if (this.lastCaptureTimestamp > 0 && elapsed < this.minSamplingIntervalMs) {
      const waitTime = this.minSamplingIntervalMs - elapsed;
      throw new SamplingRateExceededError(
        `Sampling rate limit exceeded. Must wait ${waitTime}ms before acquiring next sample (min interval: ${this.minSamplingIntervalMs}ms).`
      );
    }

    this.lastCaptureTimestamp = now;
    return {
      ...candidate,
      timestamp: now
    };
  }

  /**
   * Convenience method to load a deterministic synthetic frame bounded by capture constraints.
   */
  public captureSyntheticFrame(key: keyof typeof SYNTHETIC_FRAMES | string): FramePayload {
    const frameDef = getSyntheticFrameByKey(key);
    if (!frameDef) {
      throw new Error(`Synthetic frame definition '${key}' not found.`);
    }

    const payload: FramePayload = {
      frameId: frameDef.frameId,
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      byteSize: Buffer.byteLength(frameDef.ocrContent, 'utf8') + 512,
      isSynthetic: true,
      application: frameDef.application,
      windowTitle: frameDef.windowTitle,
      ocrContent: frameDef.ocrContent,
      metadata: {
        name: frameDef.name,
        description: frameDef.description,
        suggestedQuery: frameDef.suggestedQuery,
        expectedIntent: frameDef.expectedIntent,
        expectedRiskLevel: frameDef.expectedRiskLevel
      }
    };

    return this.capture(payload);
  }

  public getMinSamplingIntervalMs(): number {
    return this.minSamplingIntervalMs;
  }

  public getMaxDimension(): FrameDimension {
    return { ...this.maxDimension };
  }

  public getMaxByteSize(): number {
    return this.maxByteSize;
  }

  public resetSamplingTimer(): void {
    this.lastCaptureTimestamp = 0;
  }
}
