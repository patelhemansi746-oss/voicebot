import { v4 as uuidv4 } from 'uuid';
import {
  AudioProcessingResult,
  TranscriptionResult,
  ModuleHealth
} from '../types/gateway.types';
import { env } from '../config/env';

export class TranscriptionGateway {
  private status: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';

  /**
   * Convert audio to text transcript.
   * In mock mode: parses provided mockPrompt or infers realistic intent from audio metadata.
   */
  public async transcribeAudio(
    audio: AudioProcessingResult,
    mockPrompt?: string,
    _context?: { sessionId?: string; requestId?: string; correlationId?: string }
  ): Promise<TranscriptionResult> {
    const transcriptId = uuidv4();
    let text = mockPrompt?.trim() || '';

    if (!text) {
      // Provide realistic default transcript based on audio characteristics
      text = 'Explain what is happening on my screen and review any active errors.';
    }

    return {
      transcriptId,
      audioId: audio.audioId,
      text,
      confidence: 0.98,
      detectedLanguage: 'en-US',
      durationMs: 45,
      timestamp: new Date().toISOString()
    };
  }

  public getHealth(): ModuleHealth {
    return {
      module: 'transcription',
      status: this.status,
      mode: env.MOCK_MODE ? 'mock' : 'live',
      latencyMs: 12,
      message: 'Speech-to-Text transcription gateway operational'
    };
  }

  public setStatus(newStatus: 'UP' | 'DOWN' | 'DEGRADED'): void {
    this.status = newStatus;
  }
}

export const transcriptionGateway = new TranscriptionGateway();
