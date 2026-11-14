import { corsOptions } from '../../src/middleware/cors.middleware';
import { env } from '../../src/config/env';

describe('CORS Middleware', () => {
  it('should allow any origin by default when wildcard is set', (done) => {
    if (typeof corsOptions.origin === 'function') {
      corsOptions.origin('http://example.com', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    } else {
      done();
    }
  });

  it('should allow request with no origin (e.g. mobile/curl)', (done) => {
    if (typeof corsOptions.origin === 'function') {
      corsOptions.origin(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    } else {
      done();
    }
  });

  it('should reject disallowed origin if CORS_ORIGIN is restricted', (done) => {
    const originalOrigin = env.CORS_ORIGIN;
    (env as any).CORS_ORIGIN = 'http://allowed.com';

    if (typeof corsOptions.origin === 'function') {
      corsOptions.origin('http://blocked.com', (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(err?.message).toContain('CORS blocked request');
        (env as any).CORS_ORIGIN = originalOrigin;
        done();
      });
    } else {
      (env as any).CORS_ORIGIN = originalOrigin;
      done();
    }
  });
});
