import { TranscriptionGateway } from '../../src/gateways/transcription.gateway';
import { AudioProcessingResult } from '../../src/types/gateway.types';

describe('TranscriptionGateway Unit Tests', () => {
  let gateway: TranscriptionGateway;
  const mockAudio: AudioProcessingResult = {
    audioId: 'audio-001',
    format: 'pcm16',
    sampleRate: 16000,
    durationMs: 1000,
    sizeBytes: 32000,
    status: 'processed',
    timestamp: new Date().toISOString()
  };

  beforeEach(() => {
    gateway = new TranscriptionGateway();
  });

  it('should transcribe audio into text using default prompt if no mockPrompt given', async () => {
    const result = await gateway.transcribeAudio(mockAudio);

    expect(result.transcriptId).toBeDefined();
    expect(result.audioId).toBe('audio-001');
    expect(result.text).toContain('Explain what is happening');
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.detectedLanguage).toBe('en-US');
  });

  it('should use provided mockPrompt if provided', async () => {
    const customPrompt = 'Calculate 100 * 5';
    const result = await gateway.transcribeAudio(mockAudio, customPrompt);

    expect(result.text).toBe(customPrompt);
    expect(result.confidence).toBe(0.98);
  });

  it('should report module health', () => {
    const health = gateway.getHealth();
    expect(health.module).toBe('transcription');
    expect(health.status).toBe('UP');

    gateway.setStatus('DOWN');
    expect(gateway.getHealth().status).toBe('DOWN');
  });
});
