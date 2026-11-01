import { Request, Response, NextFunction } from 'express';
import { loggerMiddleware } from '../../src/middleware/logger.middleware';

describe('Logger Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let finishCallback: () => void;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockRequest = {
      method: 'GET',
      originalUrl: '/api/v1/sessions',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest-agent')
    };
    mockResponse = {
      statusCode: 200,
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

  it('should call next() and attach finish listener', () => {
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockResponse.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should log request details on response finish', () => {
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    finishCallback();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] GET \/api\/v1\/sessions.*200.*ms/)
    );
  });

  it('should log 400 and 500 status codes properly', () => {
    mockResponse.statusCode = 404;
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    finishCallback();
    expect(consoleSpy).toHaveBeenCalled();

    mockResponse.statusCode = 500;
    loggerMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    finishCallback();
    expect(consoleSpy).toHaveBeenCalled();
  });
});

