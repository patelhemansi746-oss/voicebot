import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types/common.types';
import { healthService } from '../services/health.service';

const router = Router();

// Liveness monitoring endpoint (GET /health)
router.get('/', (_req: Request, res: Response) => {
  const aggregated = healthService.getAggregatedHealth();

  const response: ApiResponse = {
    success: aggregated.status !== 'DOWN',
    message: 'Voicebot backend service is healthy',
    data: aggregated,
    timestamp: new Date().toISOString()
  };

  const statusCode = aggregated.status === 'DOWN' ? 503 : 200;
  res.status(statusCode).json(response);
});

// Readiness monitoring endpoint (GET /ready or GET /health/ready)
router.get('/ready', (_req: Request, res: Response) => {
  const aggregated = healthService.getAggregatedHealth();
  const isReady = aggregated.status === 'UP';

  const response: ApiResponse = {
    success: isReady,
    message: isReady ? 'Voicebot backend service is ready' : 'Service dependencies not ready',
    data: {
      ...aggregated,
      status: isReady ? 'READY' : aggregated.status
    },
    timestamp: new Date().toISOString()
  };

  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json(response);
});

export default router;
