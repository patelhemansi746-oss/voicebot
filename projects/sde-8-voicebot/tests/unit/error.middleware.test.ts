import { Request, Response, NextFunction } from 'express';
import { AppError, errorHandler, notFoundHandler } from '../../src/middleware/error.middleware';

describe('Error Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      originalUrl: '/test-error',
      correlationId: 'test-corr-id-1',
      requestId: 'test-req-id-1',
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  describe('AppError', () => {
    it('should initialize with default status code and code', () => {
      const err = new AppError('Something went wrong');
      expect(err.message).toBe('Something went wrong');
      expect(err.statusCode).toBe(500);
      expect(err.errorCode).toBe('INTERNAL_ERROR');
      expect(err.isOperational).toBe(true);
      expect(err.retryable).toBe(true);
      expect(err.messageSafeForUser).toBe('Something went wrong');
    });

    it('should initialize with custom status, code and details', () => {
      const details = { field: 'username' };
      const err = new AppError('Invalid input', 400, 'BAD_REQUEST', details, false, 'Safe message');
      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe('BAD_REQUEST');
      expect(err.details).toEqual(details);
      expect(err.retryable).toBe(false);
      expect(err.messageSafeForUser).toBe('Safe message');
    });
  });

  describe('notFoundHandler', () => {
    it('should forward an AppError with 404 status code', () => {
      notFoundHandler(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as jest.Mock).mock.calls[0][0];
      expect(passedError).toBeInstanceOf(AppError);
      expect(passedError.statusCode).toBe(404);
      expect(passedError.errorCode).toBe('NOT_FOUND');
      expect(passedError.retryable).toBe(false);
    });
  });

  describe('errorHandler - Typed Error Envelope', () => {
    it('should handle AppError with all 5 required spec fields: code, message_safe_for_user, retryable, correlation_id, details_redacted', () => {
      const appErr = new AppError('Resource missing', 404, 'NOT_FOUND', { id: 123, password: 'secretpassword' });

      errorHandler(appErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'test-corr-id-1');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-req-id-1');
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Resource missing',
          error: {
            code: 'NOT_FOUND',
            message_safe_for_user: 'Resource missing',
            retryable: false,
            correlation_id: 'test-corr-id-1',
            details_redacted: {
              id: 123,
              password: '[REDACTED]'
            },
            details: { id: 123, password: 'secretpassword' }
          },
          timestamp: expect.any(String)
        })
      );
    });

    it('should handle payload too large error with 413 and PAYLOAD_TOO_LARGE code', () => {
      const largeErr = {
        type: 'entity.too.large',
        limit: 102400,
        message: 'request entity too large'
      };

      errorHandler(largeErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(413);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Request payload exceeds the permitted limit',
          error: expect.objectContaining({
            code: 'PAYLOAD_TOO_LARGE',
            message_safe_for_user: 'Request payload exceeds the permitted limit',
            retryable: false,
            correlation_id: 'test-corr-id-1',
            details_redacted: { limit: 102400 }
          })
        })
      );
    });

    it('should handle generic error with custom status', () => {
      const customStatusErr = {
        status: 403,
        message: 'Forbidden access'
      };

      errorHandler(customStatusErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'GENERIC_ERROR',
            message_safe_for_user: 'Forbidden access',
            retryable: false
          })
        })
      );
    });

    it('should handle generic unhandled Error as 500 with retryable=true and safe message', () => {
      const genericErr = new Error('Database connection crashed');

      errorHandler(genericErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INTERNAL_SERVER_ERROR',
            message_safe_for_user: 'An unexpected internal error occurred. Please try again later.',
            retryable: true,
            correlation_id: 'test-corr-id-1',
            details_redacted: {}
          })
        })
      );
    });
  });
});
