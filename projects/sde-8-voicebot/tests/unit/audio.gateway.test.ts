import { AudioGateway } from '../../src/gateways/audio.gateway';

describe('AudioGateway Unit Tests', () => {
  let gateway: AudioGateway;

  beforeEach(() => {
    gateway = new AudioGateway();
  });

  it('should process default mock audio payload', async () => {
    const result = await gateway.processAudio();

    expect(result.audioId).toBeDefined();
    expect(result.format).toBe('pcm16');
    expect(result.sampleRate).toBe(16000);
    expect(result.durationMs).toBe(800);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.status).toBe('processed');
    expect(result.timestamp).toBeDefined();
  });

  it('should process custom audio chunk', async () => {
    const chunk = Buffer.from('mock-audio-bytes').toString('base64');
    const result = await gateway.processAudio({
      format: 'wav',
      sampleRate: 44100,
      chunkBase64: chunk,
      durationMs: 1500
    });

    expect(result.format).toBe('wav');
    expect(result.sampleRate).toBe(44100);
    expect(result.durationMs).toBe(1500);
    expect(result.sizeBytes).toBe(Buffer.from('mock-audio-bytes').length);
  });

  it('should report healthy module status', () => {
    const health = gateway.getHealth();
    expect(health.module).toBe('audio');
    expect(health.status).toBe('UP');
    expect(health.mode).toBe('mock');

    gateway.setStatus('DEGRADED');
    expect(gateway.getHealth().status).toBe('DEGRADED');
  });
});
