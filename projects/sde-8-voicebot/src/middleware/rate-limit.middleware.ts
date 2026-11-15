import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

export const createRateLimiter = (options?: RateLimitOptions) => {
  const windowMs = options?.windowMs ?? 60000; // 1 minute default
  const maxRequests = options?.maxRequests ?? 100; // 100 requests per minute
  const clientStore = new Map<string, RateLimitRecord>();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Exempt health probes from rate limits
    if (req.path === '/health' || req.path === '/ready' || req.originalUrl === '/health') {
      return next();
    }

    const clientId =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown-client';

    const now = Date.now();
    const clientRecord = clientStore.get(clientId);

    if (!clientRecord || now > clientRecord.resetTime) {
      clientStore.set(clientId, { count: 1, resetTime: now + windowMs });
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    clientRecord.count++;

    if (clientRecord.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((clientRecord.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);

      return next(
        new AppError(
          `Rate limit exceeded: maximum ${maxRequests} requests per ${windowMs / 1000}s allowed`,
          429,
          'RATE_LIMIT_EXCEEDED',
          {
            limit: maxRequests,
            windowMs,
            retryAfterSeconds
          },
          true,
          `Too many requests. Please wait ${retryAfterSeconds} second(s) before trying again.`
        )
      );
    }

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - clientRecord.count));
    return next();
  };
};

export const rateLimitMiddleware = createRateLimiter();
