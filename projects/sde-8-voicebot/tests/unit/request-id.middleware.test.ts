import { Request, Response, NextFunction } from 'express';
import { requestIdMiddleware } from '../../src/middleware/request-id.middleware';

describe('Request ID Middleware Unit Tests', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let headersSet: Record<string, string>;

  beforeEach(() => {
    headersSet = {};
    mockRes = {
      setHeader: jest.fn().mockImplementation((key: string, val: string) => {
        headersSet[key] = val;
        return mockRes;
      })
    };
    mockNext = jest.fn();
  });

  it('should generate new UUIDs if headers are absent', () => {
    mockReq = {
      headers: {}
    };

    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBeDefined();
    expect(mockReq.correlationId).toBeDefined();
    expect(mockReq.requestId).toBe(mockReq.correlationId);
    expect(headersSet['X-Request-ID']).toBe(mockReq.requestId);
    expect(headersSet['X-Correlation-Id']).toBe(mockReq.correlationId);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should preserve incoming X-Request-ID and X-Correlation-Id', () => {
    mockReq = {
      headers: {
        'x-request-id': 'custom-req-12345',
        'x-correlation-id': 'custom-corr-67890'
      }
    };

    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBe('custom-req-12345');
    expect(mockReq.correlationId).toBe('custom-corr-67890');
    expect(headersSet['X-Request-ID']).toBe('custom-req-12345');
    expect(headersSet['X-Correlation-Id']).toBe('custom-corr-67890');
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should fall back to requestId if X-Correlation-Id is missing but X-Request-ID is present', () => {
    mockReq = {
      headers: {
        'x-request-id': 'req-only-999'
      }
    };

    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.requestId).toBe('req-only-999');
    expect(mockReq.correlationId).toBe('req-only-999');
    expect(headersSet['X-Request-ID']).toBe('req-only-999');
    expect(headersSet['X-Correlation-Id']).toBe('req-only-999');
  });
});
