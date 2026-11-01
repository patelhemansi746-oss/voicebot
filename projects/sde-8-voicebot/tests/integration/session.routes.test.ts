import request from 'supertest';
import { app } from '../../src/app';
import { sessionService } from '../../src/services/session.service';
import { SessionStatus } from '../../src/types/session.types';

describe('Session Routes Integration', () => {
  beforeEach(() => {
    sessionService.clearAllSessions();
  });

  describe('POST /api/v1/sessions', () => {
    it('should create a new session when body is valid', async () => {
      const payload = {
        userId: 'student-dev-01',
        initialContext: {
          activeApplication: 'VSCode',
          windowTitle: 'index.ts',
          documentType: 'typescript',
          visibleContentSnippet: 'console.error("error found");'
        },
        metadata: { team: 'SDE-8' }
      };

      const res = await request(app).post('/api/v1/sessions').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.userId).toBe('student-dev-01');
      expect(res.body.data.status).toBe(SessionStatus.ACTIVE);
      expect(res.body.data.context.activeApplication).toBe('VSCode');
    });

    it('should return 400 VALIDATION_ERROR when userId is missing', async () => {
      const res = await request(app).post('/api/v1/sessions').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('should return a list of active sessions', async () => {
      sessionService.createSession({ userId: 'u1' });
      sessionService.createSession({ userId: 'u2' });

      const res = await request(app).get('/api/v1/sessions?page=1&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.sessions.length).toBe(2);
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('should return 200 and session details for valid id', async () => {
      const created = sessionService.createSession({ userId: 'u1' });

      const res = await request(app).get(`/api/v1/sessions/${created.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(created.id);
    });

    it('should return 404 for unknown session id', async () => {
      const res = await request(app).get('/api/v1/sessions/non-existent-session-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/sessions/:id/status', () => {
    it('should update session status to paused', async () => {
      const created = sessionService.createSession({ userId: 'u1' });

      const res = await request(app)
        .patch(`/api/v1/sessions/${created.id}/status`)
        .send({ status: SessionStatus.PAUSED });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(SessionStatus.PAUSED);
    });

    it('should reject invalid status with 400 validation error', async () => {
      const created = sessionService.createSession({ userId: 'u1' });

      const res = await request(app)
        .patch(`/api/v1/sessions/${created.id}/status`)
        .send({ status: 'invalid-status-value' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 if session does not exist', async () => {
      const res = await request(app)
        .patch('/api/v1/sessions/random-id/status')
        .send({ status: SessionStatus.TERMINATED });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/sessions/:id/context', () => {
    it('should update session context successfully', async () => {
      const created = sessionService.createSession({ userId: 'u1' });

      const res = await request(app)
        .patch(`/api/v1/sessions/${created.id}/context`)
        .send({
          activeApplication: 'Firefox',
          windowTitle: 'Google Docs - Research Draft'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.context.activeApplication).toBe('Firefox');
      expect(res.body.data.context.windowTitle).toBe('Google Docs - Research Draft');
    });

    it('should return 404 for context update on non-existing session', async () => {
      const res = await request(app)
        .patch('/api/v1/sessions/non-existent/context')
        .send({ activeApplication: 'VLC' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/sessions/:id', () => {
    it('should delete existing session', async () => {
      const created = sessionService.createSession({ userId: 'u1' });

      const res = await request(app).delete(`/api/v1/sessions/${created.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sessionService.getSessionById(created.id)).toBeNull();
    });

    it('should return 404 when deleting non-existent session', async () => {
      const res = await request(app).delete('/api/v1/sessions/not-found-id');

      expect(res.status).toBe(404);
    });
  });
});

