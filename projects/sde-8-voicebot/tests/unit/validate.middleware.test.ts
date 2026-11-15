import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateBody } from '../../src/middleware/validate.middleware';
import { AppError } from '../../src/middleware/error.middleware';

describe('Validate Middleware', () => {
  const schema = z.object({
    username: z.string().min(3)
  });

  it('should call next() when body conforms to schema', () => {
    const req = { body: { username: 'alice' } } as Request;
    const res = {} as Response;
    const next = jest.fn();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with AppError(400, VALIDATION_ERROR) when body is invalid', () => {
    const req = { body: { username: 'al' } } as Request;
    const res = {} as Response;
    const next = jest.fn();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe('VALIDATION_ERROR');
  });
});
