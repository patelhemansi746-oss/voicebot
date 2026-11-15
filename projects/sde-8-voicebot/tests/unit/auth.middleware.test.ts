import { Request, Response, NextFunction } from 'express';
import { authMiddleware, DEFAULT_LOCAL_AUTH_TOKEN } from '../../src/middleware/auth.middleware';
import { AppError } from '../../src/middleware/error.middleware';

describe('Local Authorization Boundary Middleware Unit Tests', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: '/api/v1/sessions',
      originalUrl: '/api/v1/sessions',
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any
    };
    mockRes = {};
    mockNext = jest.fn();
  });

  it('should allow public health endpoints without credentials', () => {
    mockReq.path = '/health';
    mockReq.originalUrl = '/health';

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('should allow requests with valid Bearer token', () => {
    mockReq.headers = {
      authorization: `Bearer ${DEFAULT_LOCAL_AUTH_TOKEN}`
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('should reject requests with invalid Bearer token with 401 UNAUTHORIZED', () => {
    mockReq.headers = {
      authorization: 'Bearer bad-secret-token'
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = (mockNext as jest.Mock).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe('UNAUTHORIZED');
  });

  it('should allow requests with valid X-API-Key', () => {
    mockReq.headers = {
      'x-api-key': DEFAULT_LOCAL_AUTH_TOKEN
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('should reject requests with invalid X-API-Key with 401 UNAUTHORIZED', () => {
    mockReq.headers = {
      'x-api-key': 'wrong-key'
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = (mockNext as jest.Mock).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('should reject requests when strict auth is enabled and no token is supplied', () => {
    mockReq.headers = {
      'x-enforce-auth': 'true'
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = (mockNext as jest.Mock).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe('UNAUTHORIZED');
  });

  it('should reject requests originating from outside local boundary (external IP) with 403 FORBIDDEN', () => {
    mockReq.ip = '203.0.113.195';
    mockReq.headers = {
      'x-forwarded-for': '203.0.113.195'
    };

    authMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = (mockNext as jest.Mock).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.errorCode).toBe('FORBIDDEN');
  });
});
