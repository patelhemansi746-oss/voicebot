import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'key',
  'creditcard',
  'auth'
]);

/**
 * Recursively scrub sensitive keys from an object
 */
export const sanitizePayload = (data: unknown): unknown => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

export interface StructuredLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  correlationId: string;
  requestId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip?: string;
  userAgent?: string;
  message?: string;
}

export const loggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Ensure correlationId and requestId are initialized if not already done by requestIdMiddleware
  const correlationId =
    req.correlationId ||
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    uuidv4();

  const requestId =
    req.requestId ||
    (req.headers['x-request-id'] as string) ||
    correlationId;

  req.correlationId = correlationId;
  req.requestId = requestId;

  res.setHeader('X-Correlation-Id', correlationId);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;

    const level: StructuredLog['level'] =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    const logEntry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      correlationId,
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
      message: `${req.method} ${req.originalUrl || req.url} completed with status ${statusCode}`
    };

    // Output structured JSON (contains no sensitive payload fields)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(logEntry));
  });

  next();
};
