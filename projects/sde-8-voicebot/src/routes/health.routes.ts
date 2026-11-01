import { Router, Request, Response } from 'express';
import { ApiResponse } from '../types/common.types';

const router = Router();

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

export default router;

