import { Request, Response, NextFunction } from 'express';
import { loggerMiddleware, sanitizePayload } from '../../src/middleware/logger.middleware';

describe('Logger Middleware & Sensitive Payload Redaction', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let finishCallback: () => void;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockRequest = {
      method: 'POST',
      originalUrl: '/api/v1/sessions',
      headers: {},
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-agent')
    };
    mockResponse = {
      statusCode: 200,
      setHeader: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback;
        }
        return mockResponse;
      })
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should generate a correlation ID and request ID and set response headers', () => {
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockRequest.correlationId).toBeDefined();
    expect(mockRequest.requestId).toBeDefined();
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-Id', mockRequest.correlationId);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', mockRequest.requestId);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should preserve existing incoming x-correlation-id and x-request-id headers', () => {
    mockRequest.headers = {
      'x-correlation-id': 'client-corr-999',
      'x-request-id': 'client-req-888'
    };

    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockRequest.correlationId).toBe('client-corr-999');
    expect(mockRequest.requestId).toBe('client-req-888');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'client-corr-999');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'client-req-888');
  });

  it('should log structured JSON on request finish', () => {
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    finishCallback();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(loggedJson.correlationId).toBeDefined();
    expect(loggedJson.requestId).toBeDefined();
    expect(loggedJson.method).toBe('POST');
    expect(loggedJson.path).toBe('/api/v1/sessions');
    expect(loggedJson.statusCode).toBe(200);
    expect(loggedJson.level).toBe('info');
  });

  describe('sanitizePayload', () => {
    it('should redact sensitive keys (password, token, apiKey, secret)', () => {
      const payload = {
        userId: 'dev-1',
        password: 'my-super-secret-password',
        auth: {
          token: 'jwt.token.here',
          apiKey: 'secret_api_key_123'
        },
        context: {
          visibleText: 'safe content'
        }
      };

      const sanitized: any = sanitizePayload(payload);

      expect(sanitized.userId).toBe('dev-1');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.auth).toBe('[REDACTED]');
      expect(sanitized.context.visibleText).toBe('safe content');
    });

    it('should handle non-object inputs gracefully', () => {
      expect(sanitizePayload(null)).toBeNull();
      expect(sanitizePayload('string')).toBe('string');
      expect(sanitizePayload(42)).toBe(42);
    });
  });
});
