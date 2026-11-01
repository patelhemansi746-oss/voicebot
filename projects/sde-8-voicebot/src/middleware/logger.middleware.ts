import { Request, Response, NextFunction } from 'express';

export interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
  userAgent?: string;
}

export const loggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent')
    };

    const statusColor =
      res.statusCode >= 500
        ? '\x1b[31m' // Red
        : res.statusCode >= 400
        ? '\x1b[33m' // Yellow
        : res.statusCode >= 300
        ? '\x1b[36m' // Cyan
        : '\x1b[32m'; // Green

    const resetColor = '\x1b[0m';

    // Formatted stdout output
    // eslint-disable-next-line no-console
    console.log(
      `[${logEntry.timestamp}] ${logEntry.method} ${logEntry.path} ${statusColor}${logEntry.status}${resetColor} - ${logEntry.durationMs}ms`
    );
  });

  next();
};

