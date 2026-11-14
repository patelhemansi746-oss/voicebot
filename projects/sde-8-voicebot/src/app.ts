import express, { Application, Request, Response } from 'express';
import { env } from './config/env';
import { corsMiddleware } from './middleware/cors.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { loggerMiddleware } from './middleware/logger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import sessionRoutes from './routes/session.routes';
import healthRoutes from './routes/health.routes';
import { ApiResponse } from './types/common.types';

export const createApp = (): Application => {
  const app: Application = express();

  // 1. Request ID and Correlation ID tracking
  app.use(requestIdMiddleware);

  // 2. Logging
  app.use(loggerMiddleware);

  // 3. Security & Parsing with configurable payload size limits
  app.use(corsMiddleware);
  app.use(express.json({ limit: env.MAX_PAYLOAD_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.MAX_PAYLOAD_LIMIT }));

  // 4. Health and Readiness Check Routes
  app.use('/health', healthRoutes);

  // Direct /ready route for container readiness probes
  app.get('/ready', (_req: Request, res: Response) => {
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

  // 5. API Routes
  app.use(`${env.API_PREFIX}/sessions`, sessionRoutes);

  // 6. 404 Not Found Handler
  app.use(notFoundHandler);

  // 7. Global Typed Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
