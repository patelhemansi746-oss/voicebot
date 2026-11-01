import express, { Application } from 'express';
import { env } from './config/env';
import { corsMiddleware } from './middleware/cors.middleware';
import { loggerMiddleware } from './middleware/logger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import sessionRoutes from './routes/session.routes';
import healthRoutes from './routes/health.routes';

export const createApp = (): Application => {
  const app: Application = express();

  // 1. Essential Middlewares
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(loggerMiddleware);

  // 2. Health Check Route
  app.use('/health', healthRoutes);

  // 3. API Routes
  app.use(`${env.API_PREFIX}/sessions`, sessionRoutes);

  // 4. 404 Not Found Handler
  app.use(notFoundHandler);

  // 5. Global Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();

