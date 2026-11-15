import { v4 as uuidv4 } from 'uuid';
import {
  AudioInputPayload,
  AudioProcessingResult,
  ModuleHealth
} from '../types/gateway.types';
import { env } from '../config/env';

export class AudioGateway {
  private status: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';

  /**
   * Process incoming voice/audio payload in mock or streaming mode
   */
  public async processAudio(
    payload?: AudioInputPayload,
    _context?: { sessionId?: string; requestId?: string; correlationId?: string }
  ): Promise<AudioProcessingResult> {
    const audioId = uuidv4();
    const format = payload?.format || 'pcm16';
    const sampleRate = payload?.sampleRate || 16000;
    const durationMs = payload?.durationMs || (payload?.chunkBase64 ? 1200 : 800);
    const sizeBytes = payload?.chunkBase64
      ? Buffer.from(payload.chunkBase64, 'base64').length
      : Math.floor(sampleRate * (durationMs / 1000) * 2);

    return {
      audioId,
      format,
      sampleRate,
      durationMs,
      sizeBytes,
      status: 'processed',
      timestamp: new Date().toISOString()
    };
  }

  public getHealth(): ModuleHealth {
    return {
      module: 'audio',
      status: this.status,
      mode: env.MOCK_MODE ? 'mock' : 'live',
      latencyMs: 5,
      message: 'Audio ingestion gateway operational'
    };
  }

  public setStatus(newStatus: 'UP' | 'DOWN' | 'DEGRADED'): void {
    this.status = newStatus;
  }
}

export const audioGateway = new AudioGateway();
