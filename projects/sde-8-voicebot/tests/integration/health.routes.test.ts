import { request } from '../helpers/test-request';
import { app } from '../../src/app';

describe('Health, Readiness & Middleware Integration', () => {
  it('GET /health should return 200 with service status UP and tracking headers', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('UP');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('GET /ready should return 200 with readiness status READY', async () => {
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Voicebot backend service is ready');
    expect(res.body.data.status).toBe('READY');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('GET /health/ready should also return 200 with readiness status READY', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('READY');
  });

  it('should preserve and mirror client-supplied X-Request-ID and X-Correlation-Id', async () => {
    const customReqId = 'req-trace-001';
    const customCorrId = 'corr-trace-002';

    const res = await request(app)
      .get('/ready')
      .set('X-Request-ID', customReqId)
      .set('X-Correlation-Id', customCorrId);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(customReqId);
    expect(res.headers['x-correlation-id']).toBe(customCorrId);
  });

  it('should return typed error envelope on unknown routes with all 5 required spec fields', async () => {
    const res = await request(app)
      .get('/non-existent-route')
      .set('X-Request-ID', 'req-error-999');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    // Verify all 5 spec fields
    const error = res.body.error;
    expect(error).toBeDefined();
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message_safe_for_user).toContain('Endpoint not found');
    expect(error.retryable).toBe(false);
    expect(error.correlation_id).toBe('req-error-999');
    expect(error.details_redacted).toEqual({});

    // Headers set
    expect(res.headers['x-request-id']).toBe('req-error-999');
  });
});
