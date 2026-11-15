import { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../src/middleware/rate-limit.middleware';
import { AppError } from '../../src/middleware/error.middleware';

describe('Rate Limit Middleware Unit Tests', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: NextFunction;
  let headersSet: Record<string, any>;

  beforeEach(() => {
    headersSet = {};
    mockReq = {
      path: '/api/v1/sessions',
      ip: '127.0.0.1',
      headers: {}
    };
    mockRes = {
      setHeader: jest.fn().mockImplementation((k, v) => {
        headersSet[k] = v;
      })
    };
    mockNext = jest.fn();
  });

  it('should allow requests within limit', () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 10000 });

    limiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
    expect(headersSet['X-RateLimit-Limit']).toBe(3);
    expect(headersSet['X-RateLimit-Remaining']).toBe(2);
  });

  it('should reject requests exceeding limit with 429 RATE_LIMIT_EXCEEDED and set Retry-After header', () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 10000 });

    limiter(mockReq as Request, mockRes as Response, mockNext); // 1
    limiter(mockReq as Request, mockRes as Response, mockNext); // 2
    limiter(mockReq as Request, mockRes as Response, mockNext); // 3 (exceeds)

    expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
    const err = (mockNext as jest.Mock).mock.calls[2][0];
    expect(err.statusCode).toBe(429);
    expect(err.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.retryable).toBe(true);
    expect(headersSet['Retry-After']).toBeDefined();
  });

  it('should exempt health check endpoints from rate limiting', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 10000 });
    mockReq.path = '/health';

    limiter(mockReq as Request, mockRes as Response, mockNext);
    limiter(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(2);
    expect(mockNext).not.toHaveBeenCalledWith(expect.any(AppError));
  });
});
