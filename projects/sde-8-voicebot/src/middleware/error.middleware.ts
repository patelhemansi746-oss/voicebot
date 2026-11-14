import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse, ApiErrorEnvelope } from '../types/common.types';
import { sanitizePayload } from './logger.middleware';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;
  public readonly retryable: boolean;
  public readonly messageSafeForUser: string;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    details?: unknown,
    retryable?: boolean,
    messageSafeForUser?: string
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    this.details = details;
    this.retryable = retryable ?? (statusCode >= 500 || statusCode === 429);
    this.messageSafeForUser = messageSafeForUser ?? message;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError(`Endpoint not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND', undefined, false));
};

export const errorHandler = (
  err: Error | AppError | any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let messageSafeForUser = message;
  let retryable = false;
  let details: unknown = undefined;

  const correlationId =
    req.correlationId ||
    req.requestId ||
    (req.headers['x-correlation-id'] as string) ||
    (req.headers['x-request-id'] as string) ||
    uuidv4();

  const requestId =
    req.requestId ||
    (req.headers['x-request-id'] as string) ||
    correlationId;

  // Ensure headers are reflected on error responses
  res.setHeader('X-Correlation-Id', correlationId);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Request-Id', requestId);

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    details = err.details;
    retryable = err.retryable;
    messageSafeForUser = err.messageSafeForUser || err.message;
  } else if (err.type === 'entity.too.large' || err.statusCode === 413) {
    statusCode = 413;
    errorCode = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload exceeds the permitted limit';
    messageSafeForUser = message;
    retryable = false;
    details = { limit: err.limit };
  } else if (err.status && typeof err.status === 'number') {
    statusCode = err.status;
    retryable = statusCode >= 500 || statusCode === 429;
    errorCode = statusCode === 404 ? 'NOT_FOUND' : statusCode === 400 ? 'BAD_REQUEST' : 'GENERIC_ERROR';
    messageSafeForUser = err.message || 'An error occurred';
  } else {
    // Unhandled 500 Internal Error
    statusCode = 500;
    errorCode = 'INTERNAL_SERVER_ERROR';
    retryable = true;
    messageSafeForUser = 'An unexpected internal error occurred. Please try again later.';
  }

  // Sanitize details to redact sensitive keys (passwords, tokens, apikeys)
  const detailsRedacted = details ? sanitizePayload(details) : {};

  const errorEnvelope: ApiErrorEnvelope = {
    code: errorCode,
    message_safe_for_user: messageSafeForUser,
    retryable,
    correlation_id: correlationId,
    details_redacted: detailsRedacted,
    details
  };

  const response: ApiResponse = {
    success: false,
    message: messageSafeForUser,
    error: errorEnvelope,
    timestamp: new Date().toISOString()
  };

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        correlationId,
        requestId,
        statusCode,
        message: err.message,
        stack: err.stack
      })
    );
  }

  res.status(statusCode).json(response);
};
