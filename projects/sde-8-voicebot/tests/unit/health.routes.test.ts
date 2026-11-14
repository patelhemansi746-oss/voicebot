import { Request, Response, NextFunction } from 'express';
import healthRouter from '../../src/routes/health.routes';

describe('Health & Readiness Route Unit Tests', () => {
  let statusCode = 0;
  let jsonOutput: any;
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    statusCode = 0;
    jsonOutput = undefined;
    req = {} as Request;
    res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonOutput = data;
        return res;
      }
    } as unknown as Response;
    next = jest.fn() as NextFunction;
  });

  it('should return 200 with status UP on GET /', () => {
    const route = healthRouter.stack.find((layer) => layer.route?.path === '/');
    const handler = route?.route?.stack[0]?.handle;

    expect(handler).toBeDefined();
    if (handler) {
      handler(req, res, next);
    }

    expect(statusCode).toBe(200);
    expect(jsonOutput.success).toBe(true);
    expect(jsonOutput.data.status).toBe('UP');
    expect(jsonOutput.data.uptime).toBeDefined();
  });

  it('should return 200 with status READY on GET /ready', () => {
    const route = healthRouter.stack.find((layer) => layer.route?.path === '/ready');
    const handler = route?.route?.stack[0]?.handle;

    expect(handler).toBeDefined();
    if (handler) {
      handler(req, res, next);
    }

    expect(statusCode).toBe(200);
    expect(jsonOutput.success).toBe(true);
    expect(jsonOutput.message).toBe('Voicebot backend service is ready');
    expect(jsonOutput.data.status).toBe('READY');
    expect(jsonOutput.data.uptime).toBeDefined();
  });
});
