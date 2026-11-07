import { SessionService } from '../../src/services/session.service';
import { SessionStatus, SessionEventType } from '../../src/types/session.types';
import { AppError } from '../../src/middleware/error.middleware';

describe('SessionService - Lifecycle & Events (Days 8-14)', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
  });

  afterEach(() => {
    service.clearAllSessions();
  });

  describe('Session Lifecycle Transitions', () => {
    it('should create an active session and record creation event', () => {
      const session = service.createSession({ userId: 'dev-001' });

      expect(session.id).toBeDefined();
      expect(session.status).toBe(SessionStatus.ACTIVE);

      const events = service.getSessionEvents(session.id);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe(SessionEventType.SESSION_CREATED);
    });

    it('should pause an active session and emit pause event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      const paused = service.pauseSession(session.id);

      expect(paused.status).toBe(SessionStatus.PAUSED);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_PAUSED)).toBe(true);
    });

    it('should be IDEMPOTENT when pausing an already paused session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.pauseSession(session.id);

      // Repeated pause command
      const repeated = service.pauseSession(session.id);
      expect(repeated.status).toBe(SessionStatus.PAUSED);
    });

    it('should resume a paused session and emit resume event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.pauseSession(session.id);

      const resumed = service.resumeSession(session.id);
      expect(resumed.status).toBe(SessionStatus.ACTIVE);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_RESUMED)).toBe(true);
    });

    it('should be IDEMPOTENT when resuming an already active session', () => {
      const session = service.createSession({ userId: 'dev-001' });

      // Already active, repeated resume command
      const resumed = service.resumeSession(session.id);
      expect(resumed.status).toBe(SessionStatus.ACTIVE);
    });

    it('should stop an active session and be idempotent on repeat', () => {
      const session = service.createSession({ userId: 'dev-001' });
      const stopped = service.stopSession(session.id);

      expect(stopped.status).toBe(SessionStatus.STOPPED);

      // Repeated stop command is idempotent
      const repeated = service.stopSession(session.id);
      expect(repeated.status).toBe(SessionStatus.STOPPED);
    });

    it('should REJECT illegal transitions from STOPPED state with 409 ILLEGAL_TRANSITION', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.stopSession(session.id);

      expect(() => service.pauseSession(session.id)).toThrow(AppError);
      expect(() => service.resumeSession(session.id)).toThrow(AppError);

      try {
        service.resumeSession(session.id);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.errorCode).toBe('ILLEGAL_TRANSITION');
      }
    });

    it('should REJECT context updates on a stopped session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.stopSession(session.id);

      expect(() =>
        service.updateSessionContext(session.id, { activeApplication: 'VSCode' })
      ).toThrow(AppError);
    });
  });

  describe('Session Expiry', () => {
    it('should automatically expire sessions exceeding inactivity timeout', () => {
      const session = service.createSession({ userId: 'dev-001' });

      // Expire session with 0 minutes inactivity threshold
      const expiredCount = service.checkAndExpireSessions(0);
      expect(expiredCount).toBe(1);

      const updated = service.getSessionById(session.id);
      expect(updated?.status).toBe(SessionStatus.EXPIRED);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_EXPIRED)).toBe(true);
    });

    it('should REJECT illegal transitions on EXPIRED session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.checkAndExpireSessions(0);

      expect(() => service.pauseSession(session.id)).toThrow(AppError);
      expect(() => service.resumeSession(session.id)).toThrow(AppError);
    });
  });

  describe('Event Streaming & Replay', () => {
    it('should stream events in order and notify real-time subscribers', (done) => {
      const session = service.createSession({ userId: 'dev-001' });
      let receivedEvents: string[] = [];

      const unsubscribe = service.subscribeToSessionEvents(session.id, (event) => {
        receivedEvents.push(event.type);
        if (receivedEvents.length === 2) {
          expect(receivedEvents).toEqual([
            SessionEventType.SESSION_PAUSED,
            SessionEventType.SESSION_RESUMED
          ]);
          unsubscribe();
          done();
        }
      });

      service.pauseSession(session.id);
      service.resumeSession(session.id);
    });
  });

  describe('Pagination & Deletion', () => {
    it('should paginate sessions and clean up on delete', () => {
      const s1 = service.createSession({ userId: 'u1' });
      const s2 = service.createSession({ userId: 'u2' });

      const page = service.getAllSessions(1, 1);
      expect(page.sessions.length).toBe(1);
      expect(page.total).toBe(2);

      const deleted = service.deleteSession(s1.id);
      expect(deleted).toBe(true);
      expect(service.getSessionById(s1.id)).toBeNull();
    });
  });
});
