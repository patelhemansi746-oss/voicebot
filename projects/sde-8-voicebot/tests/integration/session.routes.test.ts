import { request } from '../helpers/test-request';
import { app } from '../../src/app';
import { sessionService } from '../../src/services/session.service';
import { SessionStatus } from '../../src/types/session.types';

describe('Session Routes Integration - 7-State Lifecycle & Streaming', () => {
  beforeEach(() => {
    sessionService.clearAllSessions();
  });

  afterEach(() => {
    sessionService.clearAllSessions();
  });

  describe('POST /api/v1/sessions', () => {
    it('should create a new session in CREATED state and return X-Correlation-Id and X-Request-ID headers', async () => {
      const payload = {
        userId: 'student-dev-01',
        initialContext: {
          activeApplication: 'VSCode',
          windowTitle: 'index.ts',
          documentType: 'typescript',
          visibleContentSnippet: 'console.log("ready");'
        }
      };

      const res = await request(app)
        .post('/api/v1/sessions')
        .set('X-Correlation-Id', 'test-cid-101')
        .set('X-Request-ID', 'test-rid-101')
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.headers['x-correlation-id']).toBe('test-cid-101');
      expect(res.headers['x-request-id']).toBe('test-rid-101');
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe(SessionStatus.CREATED);
    });

    it('should return typed error envelope (400 VALIDATION_ERROR) on missing userId with all 5 required spec fields', async () => {
      const res = await request(app)
        .post('/api/v1/sessions')
        .set('X-Request-ID', 'val-err-req')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);

      const error = res.body.error;
      expect(error).toBeDefined();
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message_safe_for_user).toBeDefined();
      expect(error.retryable).toBe(false);
      expect(error.correlation_id).toBe('val-err-req');
      expect(error.details_redacted).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('Session Lifecycle Transitions & Idempotency', () => {
    it('should start a created session to ACTIVE', async () => {
      const created = sessionService.createSession({ userId: 'u1' });
      expect(created.status).toBe(SessionStatus.CREATED);

      const res = await request(app).post(`/api/v1/sessions/${created.id}/start`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(SessionStatus.ACTIVE);
    });

    it('should pause an active session and be idempotent on repeat', async () => {
      const created = sessionService.createSession({ userId: 'u1' });
      sessionService.startSession(created.id);

      // First pause
      const res1 = await request(app).post(`/api/v1/sessions/${created.id}/pause`);
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe(SessionStatus.PAUSED);

      // Repeated pause (Idempotency check)
      const res2 = await request(app).post(`/api/v1/sessions/${created.id}/pause`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe(SessionStatus.PAUSED);
    });

    it('should resume a paused session and be idempotent on repeat', async () => {
      const created = sessionService.createSession({ userId: 'u1' });
      sessionService.startSession(created.id);
      sessionService.pauseSession(created.id);

      // First resume
      const res1 = await request(app).post(`/api/v1/sessions/${created.id}/resume`);
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe(SessionStatus.ACTIVE);

      // Repeated resume (Idempotency check)
      const res2 = await request(app).post(`/api/v1/sessions/${created.id}/resume`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe(SessionStatus.ACTIVE);
    });

    it('should stop a session into COMPLETED and be idempotent on repeat', async () => {
      const created = sessionService.createSession({ userId: 'u1' });
      sessionService.startSession(created.id);

      const res1 = await request(app).post(`/api/v1/sessions/${created.id}/stop`);
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe(SessionStatus.COMPLETED);

      const res2 = await request(app).post(`/api/v1/sessions/${created.id}/stop`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe(SessionStatus.COMPLETED);
    });

    it('should REJECT illegal transitions (resume a completed session) with 409 ILLEGAL_TRANSITION', async () => {
      const created = sessionService.createSession({ userId: 'u1' });
      sessionService.startSession(created.id);
      sessionService.stopSession(created.id);

      const res = await request(app).post(`/api/v1/sessions/${created.id}/resume`);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
      expect(res.body.error.message_safe_for_user).toContain('terminal status');
      expect(res.body.error.retryable).toBe(false);
      expect(res.body.error.correlation_id).toBeDefined();
    });
  });

  describe('GET /api/v1/sessions/:id/events (Event Streaming SSE)', () => {
    it('should set text/event-stream headers and replay event history', async () => {
      const session = sessionService.createSession({ userId: 'stream-user' });
      sessionService.startSession(session.id);
      sessionService.pauseSession(session.id);

      const res = await request(app)
        .get(`/api/v1/sessions/${session.id}/events`)
        .set('Accept', 'text/event-stream');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(res.text).toContain('session.created');
      expect(res.text).toContain('session.active');
      expect(res.text).toContain('session.paused');
    });

    it('should return 404 SESSION_NOT_FOUND when streaming non-existent session', async () => {
      const res = await request(app).get('/api/v1/sessions/invalid-id/events');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
      expect(res.body.error.retryable).toBe(false);
    });
  });

  describe('Context and Deletion', () => {
    it('should update context for active session', async () => {
      const session = sessionService.createSession({ userId: 'u1' });
      sessionService.startSession(session.id);

      const res = await request(app)
        .patch(`/api/v1/sessions/${session.id}/context`)
        .send({ windowTitle: 'Updated Window' });

      expect(res.status).toBe(200);
      expect(res.body.data.context.windowTitle).toBe('Updated Window');
    });

    it('should delete existing session', async () => {
      const session = sessionService.createSession({ userId: 'u1' });

      const res = await request(app).delete(`/api/v1/sessions/${session.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
