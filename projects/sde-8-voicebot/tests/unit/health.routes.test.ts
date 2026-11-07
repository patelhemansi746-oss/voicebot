import { Request, Response, NextFunction } from 'express';
import healthRouter from '../../src/routes/health.routes';

describe('Health Route Unit', () => {
  it('should return 200 with status UP', () => {
    let statusCode = 0;
    let jsonOutput: any;

    const req = {} as Request;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonOutput = data;
        return res;
      }
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

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
});
