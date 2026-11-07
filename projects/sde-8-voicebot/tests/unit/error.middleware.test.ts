import { Request, Response, NextFunction } from 'express';
import { AppError, errorHandler, notFoundHandler } from '../../src/middleware/error.middleware';

describe('Error Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      originalUrl: '/test-error'
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
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
    });

    it('should initialize with custom status, code and details', () => {
      const details = { field: 'username' };
      const err = new AppError('Invalid input', 400, 'BAD_REQUEST', details);
      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe('BAD_REQUEST');
      expect(err.details).toEqual(details);
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
    });
  });

  describe('errorHandler', () => {
    it('should handle AppError with defined status and json response', () => {
      const appErr = new AppError('Resource missing', 404, 'NOT_FOUND', { id: 123 });

      errorHandler(appErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Resource missing',
          error: {
            code: 'NOT_FOUND',
            details: { id: 123 }
          }
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
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            details: { limit: 102400 }
          }
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
    });

    it('should handle generic unhandled Error as 500', () => {
      const genericErr = new Error('Unexpected crash');

      errorHandler(genericErr, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Unexpected crash',
          error: {
            code: 'INTERNAL_SERVER_ERROR'
          }
        })
      );
    });
  });
});
