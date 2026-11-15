import { request } from '../helpers/test-request';
import { app } from '../../src/app';
import { sessionService } from '../../src/services/session.service';
import { DEFAULT_LOCAL_AUTH_TOKEN } from '../../src/middleware/auth.middleware';

describe('Week 3 Integration - Gateways, Event Replay, Auth Boundary & Rate Limits', () => {
  beforeEach(() => {
    sessionService.clearAllSessions();
  });

  afterEach(() => {
    sessionService.clearAllSessions();
  });

  describe('End-to-End Mock Session Routing (Audio ➔ Transcription ➔ Reasoning ➔ Workflow)', () => {
    it('should route mathematical question through all 4 gateways and return calculation result', async () => {
      const session = sessionService.createSession({ userId: 'math-user' });

      const res = await request(app)
        .post(`/api/v1/sessions/${session.id}/interact`)
        .set('X-Correlation-Id', 'corr-turn-1')
        .set('X-Request-ID', 'req-turn-1')
        .send({
          promptText: 'Please calculate 25 * 4 + 150',
          audio: { format: 'pcm16', sampleRate: 16000 }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.audioResult).toBeDefined();
      expect(data.transcriptionResult).toBeDefined();
      expect(data.transcriptionResult.text).toContain('calculate');
      expect(data.reasoningResult.intent).toBe('EXECUTE_TOOL');
      expect(data.workflowResult).toBeDefined();
      expect(data.workflowResult.toolName).toBe('calculator');
      expect(data.workflowResult.approvedBy).toBe('AUTO');
      expect(data.finalResponse).toContain('250');
      expect(data.correlationId).toBe('corr-turn-1');
      expect(data.requestId).toBe('req-turn-1');
    });

    it('should trigger Human-in-the-Loop safety gate (403 APPROVAL_REQUIRED) on sensitive tool without approval', async () => {
      const session = sessionService.createSession({ userId: 'safe-user' });

      const res = await request(app)
        .post(`/api/v1/sessions/${session.id}/interact`)
        .send({
          promptText: 'Modify notes.txt and save file'
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('APPROVAL_REQUIRED');
      expect(res.body.error.message_safe_for_user).toContain('requires your approval');
      expect(res.body.error.retryable).toBe(false);
      expect(res.body.error.details_redacted).toBeDefined();
    });

    it('should execute sensitive tool successfully when humanApproved is true', async () => {
      const session = sessionService.createSession({ userId: 'safe-user' });

      const res = await request(app)
        .post(`/api/v1/sessions/${session.id}/interact`)
        .send({
          promptText: 'Modify notes.txt and save file',
          humanApproved: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workflowResult.approvedBy).toBe('HUMAN');
      expect(res.body.data.finalResponse).toContain('File operation authorized');
    });
  });

  describe('Event History, Replay and Reconnect (Zero Gaps, Zero Duplicates)', () => {
    it('should replay historical events with sequence numbers and handle reconnect via Last-Event-ID', async () => {
      const session = sessionService.createSession({ userId: 'event-user' });
      sessionService.startSession(session.id); // Seq 2
      sessionService.pauseSession(session.id); // Seq 3
      sessionService.resumeSession(session.id); // Seq 4

      // 1. Initial connect: receive all 4 events
      const resFull = await request(app)
        .get(`/api/v1/sessions/${session.id}/events`)
        .set('Accept', 'text/event-stream');

      expect(resFull.status).toBe(200);
      expect(resFull.text).toContain('id: 1');
      expect(resFull.text).toContain('id: 2');
      expect(resFull.text).toContain('id: 3');
      expect(resFull.text).toContain('id: 4');

      // 2. Reconnecting client with Last-Event-ID: 2 receives only seq 3 and seq 4 (no gaps, no duplicates)
      const resReconnect = await request(app)
        .get(`/api/v1/sessions/${session.id}/events`)
        .set('Accept', 'text/event-stream')
        .set('Last-Event-ID', '2');

      expect(resReconnect.status).toBe(200);
      expect(resReconnect.text).not.toContain('id: 1\n');
      expect(resReconnect.text).not.toContain('id: 2\n');
      expect(resReconnect.text).toContain('id: 3\n');
      expect(resReconnect.text).toContain('id: 4\n');
    });
  });

  describe('Local Authorization Boundary Rejection', () => {
    it('should reject requests with invalid Bearer token with 401 UNAUTHORIZED typed error envelope', async () => {
      const res = await request(app)
        .get('/api/v1/sessions')
        .set('Authorization', 'Bearer invalid-token-xyz');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message_safe_for_user).toContain('Invalid bearer token');
      expect(res.body.error.retryable).toBe(false);
    });

    it('should reject requests from outside local boundary (external IP) with 403 FORBIDDEN typed error envelope', async () => {
      const res = await request(app)
        .get('/api/v1/sessions')
        .set('X-Forwarded-For', '198.51.100.24');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message_safe_for_user).toContain('External network requests');
    });

    it('should allow authorized requests with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/sessions')
        .set('Authorization', `Bearer ${DEFAULT_LOCAL_AUTH_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
