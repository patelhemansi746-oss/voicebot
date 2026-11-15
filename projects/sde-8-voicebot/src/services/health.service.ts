import { audioGateway } from '../gateways/audio.gateway';
import { transcriptionGateway } from '../gateways/transcription.gateway';
import { reasoningGateway } from '../gateways/reasoning.gateway';
import { workflowGateway } from '../gateways/workflow.gateway';
import { sessionService } from './session.service';
import { AggregatedHealthData } from '../types/gateway.types';

export class HealthService {
  /**
   * Aggregate health across all backend modules
   */
  public getAggregatedHealth(): AggregatedHealthData {
    const audioHealth = audioGateway.getHealth();
    const transcriptionHealth = transcriptionGateway.getHealth();
    const reasoningHealth = reasoningGateway.getHealth();
    const workflowHealth = workflowGateway.getHealth();

    const modules = {
      audio: audioHealth,
      transcription: transcriptionHealth,
      reasoning: reasoningHealth,
      workflow: workflowHealth
    };

    const statuses = [
      audioHealth.status,
      transcriptionHealth.status,
      reasoningHealth.status,
      workflowHealth.status
    ];

    let overallStatus: AggregatedHealthData['status'] = 'UP';
    if (statuses.includes('DOWN')) {
      overallStatus = 'DOWN';
    } else if (statuses.includes('DEGRADED')) {
      overallStatus = 'DEGRADED';
    }

    const { total } = sessionService.getAllSessions(1, 1);

    return {
      status: overallStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      modules,
      activeSessions: total
    };
  }
}

export const healthService = new HealthService();
