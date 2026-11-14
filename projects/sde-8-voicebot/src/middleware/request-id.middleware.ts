import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware that extracts or generates a unique Request ID (and Correlation ID)
 * for every incoming HTTP request and sets them on the response headers.
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingRequestId = (req.headers['x-request-id'] as string) || (req.headers['x-request-id'.toLowerCase()] as string);
  const incomingCorrelationId = (req.headers['x-correlation-id'] as string) || (req.headers['x-correlation-id'.toLowerCase()] as string);

  const requestId = incomingRequestId && incomingRequestId.trim() !== '' ? incomingRequestId : uuidv4();
  const correlationId = incomingCorrelationId && incomingCorrelationId.trim() !== '' ? incomingCorrelationId : requestId;

  req.requestId = requestId;
  req.correlationId = correlationId;

  // Set response headers (provide both casing variants for X-Request-ID)
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Correlation-Id', correlationId);

  next();
};
