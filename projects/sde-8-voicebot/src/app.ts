import express, { Application, Request, Response } from 'express';
import { env } from './config/env';
import { corsMiddleware } from './middleware/cors.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { loggerMiddleware } from './middleware/logger.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import sessionRoutes from './routes/session.routes';
import healthRoutes from './routes/health.routes';
import { healthService } from './services/health.service';
import { ApiResponse } from './types/common.types';

export const createApp = (): Application => {
  const app: Application = express();

  // 1. Request ID and Correlation ID tracking (propagates across all requests & logs)
  app.use(requestIdMiddleware);

  // 2. Structured Logging with Correlation IDs & Sensitive Key Redaction
  app.use(loggerMiddleware);

  // 3. Security & Parsing with configurable payload size limits
  app.use(corsMiddleware);
  app.use(rateLimitMiddleware);
  app.use(express.json({ limit: env.MAX_PAYLOAD_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.MAX_PAYLOAD_LIMIT }));

  // 4. Health and Readiness Check Routes (exempt from auth boundary)
  app.use('/health', healthRoutes);

  // Direct /ready route for container readiness probes with aggregated module health
  app.get('/ready', (_req: Request, res: Response) => {
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
    res.status(isReady ? 200 : 503).json(response);
  });

  // 5. Local Authorization Boundary
  app.use(authMiddleware);

  // 6. API Routes
  app.use(`${env.API_PREFIX}/sessions`, sessionRoutes);

  // 7. 404 Not Found Handler
  app.use(notFoundHandler);

  // 8. Global Typed Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
