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
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const errorCode = err instanceof AppError ? err.errorCode : 'INTERNAL_SERVER_ERROR';
  const details = err instanceof AppError ? err.details : undefined;

  const response: ApiResponse = {
    success: false,
    message: err.message || 'An unexpected error occurred',
    error: {
      code: errorCode,
      details
    },
    timestamp: new Date().toISOString()
  };

  // Only log full stack in development/non-operational errors
  if (statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[Error] ${statusCode} - ${err.message}`, err.stack);
  }

  res.status(statusCode).json(response);
};

