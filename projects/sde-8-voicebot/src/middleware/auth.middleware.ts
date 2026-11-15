import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware';

export const DEFAULT_LOCAL_AUTH_TOKEN = 'voicebot-local-token';

export const isLocalIp = (ip?: string): boolean => {
  if (!ip) return true;
  const cleaned = ip.replace(/^.*:/, ''); // normalize IPv6 mapped IPv4
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost' ||
    cleaned === '1' ||
    cleaned === '127.0.0.1'
  );
};

/**
 * Middleware enforcing the local authorization boundary:
 * 1. Validates Bearer token or X-API-Key when provided.
 * 2. Rejects invalid credentials with 401 UNAUTHORIZED in typed error envelope.
 * 3. Enforces local machine boundary; requests from non-local IPs are rejected with 403 FORBIDDEN.
 * 4. Supports strict auth mode when configured or requested via x-enforce-auth.
 */
export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  // Public health and readiness monitoring endpoints are exempt
  const publicPaths = ['/health', '/ready', '/health/ready'];
  if (publicPaths.includes(req.path) || req.originalUrl === '/health' || req.originalUrl === '/ready') {
    return next();
  }

  const clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.ip ||
    req.socket.remoteAddress;

  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const configuredToken = process.env.LOCAL_AUTH_TOKEN || DEFAULT_LOCAL_AUTH_TOKEN;

  // 1. If explicit credentials provided, validate them
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === configuredToken) {
        return next();
      }
    }
    return next(
      new AppError(
        'Unauthorized: Invalid authorization credentials',
        401,
        'UNAUTHORIZED',
        { reason: 'Invalid bearer token' },
        false,
        'Unauthorized: Invalid bearer token supplied.'
      )
    );
  }

  if (apiKeyHeader) {
    if (apiKeyHeader.trim() === configuredToken) {
      return next();
    }
    return next(
      new AppError(
        'Unauthorized: Invalid API key',
        401,
        'UNAUTHORIZED',
        { reason: 'Invalid X-API-Key' },
        false,
        'Unauthorized: Invalid API key supplied.'
      )
    );
  }

  // 2. If strict auth is enforced, require credentials
  if (process.env.STRICT_LOCAL_AUTH === 'true' || req.headers['x-enforce-auth'] === 'true') {
    return next(
      new AppError(
        'Unauthorized: Local authorization token required',
        401,
        'UNAUTHORIZED',
        { reason: 'Missing authorization header' },
        false,
        'Unauthorized: Local authorization token is required.'
      )
    );
  }

  // 3. Enforce local authorization boundary (block external networks)
  if (clientIp && !isLocalIp(clientIp)) {
    return next(
      new AppError(
        `Forbidden: Request origin '${clientIp}' is outside the permitted local authorization boundary`,
        403,
        'FORBIDDEN',
        { clientIp, boundary: 'local-only' },
        false,
        'Forbidden: External network requests outside the local authorization boundary are blocked.'
      )
    );
  }

  return next();
};
