import { healthService } from '../../src/services/health.service';
import { audioGateway } from '../../src/gateways/audio.gateway';

describe('HealthService Unit Tests', () => {
  afterEach(() => {
    audioGateway.setStatus('UP');
  });

  it('should aggregate health across all 4 module gateways as UP', () => {
    const health = healthService.getAggregatedHealth();

    expect(health.status).toBe('UP');
    expect(health.modules.audio.status).toBe('UP');
    expect(health.modules.transcription.status).toBe('UP');
    expect(health.modules.reasoning.status).toBe('UP');
    expect(health.modules.workflow.status).toBe('UP');
    expect(typeof health.uptime).toBe('number');
  });

  it('should reflect DEGRADED status when a module is degraded', () => {
    audioGateway.setStatus('DEGRADED');

    const health = healthService.getAggregatedHealth();
    expect(health.status).toBe('DEGRADED');
    expect(health.modules.audio.status).toBe('DEGRADED');
  });

  it('should reflect DOWN status when a module is down', () => {
    audioGateway.setStatus('DOWN');

    const health = healthService.getAggregatedHealth();
    expect(health.status).toBe('DOWN');
  });
});
