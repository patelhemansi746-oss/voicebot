import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types/common.types';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  next(new AppError(`Endpoint not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
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
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    details = err.details;
  } else if (err.type === 'entity.too.large' || err.statusCode === 413) {
    statusCode = 413;
    errorCode = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload exceeds the permitted limit';
    details = { limit: err.limit };
  } else if (err.status && typeof err.status === 'number') {
    statusCode = err.status;
  }

  const response: ApiResponse = {
    success: false,
    message,
    error: {
      code: errorCode,
      details
    },
    timestamp: new Date().toISOString()
  };

  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        correlationId: req.correlationId,
        statusCode,
        message: err.message,
        stack: err.stack
      })
    );
  }

  res.status(statusCode).json(response);
};
