import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types/common.types';

const router = Router();

// Liveness monitoring endpoint (GET /health)
router.get('/', (_req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    message: 'Voicebot backend service is healthy',
    data: {
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };

  res.status(200).json(response);
});

// Readiness monitoring endpoint (GET /ready or GET /health/ready)
router.get('/ready', (_req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    message: 'Voicebot backend service is ready',
    data: {
      status: 'READY',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };

  res.status(200).json(response);
});

export default router;
