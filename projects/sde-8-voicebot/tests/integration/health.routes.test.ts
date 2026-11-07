import { request } from '../helpers/test-request';
import { app } from '../../src/app';

describe('Health Routes Integration', () => {
  it('GET /health should return 200 with service status and uptime', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('UP');
    expect(res.body.data.uptime).toBeDefined();
  });

  it('GET /unknown-path should return 404 NOT_FOUND', async () => {
    const res = await request(app).get('/non-existent-route');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
