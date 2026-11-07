import express, { Application } from 'express';
import { env } from './config/env';
import { corsMiddleware } from './middleware/cors.middleware';
import { loggerMiddleware } from './middleware/logger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import sessionRoutes from './routes/session.routes';
import healthRoutes from './routes/health.routes';

export const createApp = (): Application => {
  const app: Application = express();

  // 1. Logging and Correlation ID tracking
  app.use(loggerMiddleware);

  // 2. Security & Parsing with configurable payload size limits
  app.use(corsMiddleware);
  app.use(express.json({ limit: env.MAX_PAYLOAD_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.MAX_PAYLOAD_LIMIT }));

  // 3. Health Check Route
  app.use('/health', healthRoutes);

  // 4. API Routes
  app.use(`${env.API_PREFIX}/sessions`, sessionRoutes);

  // 5. 404 Not Found Handler
  app.use(notFoundHandler);

  // 6. Global Typed Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
