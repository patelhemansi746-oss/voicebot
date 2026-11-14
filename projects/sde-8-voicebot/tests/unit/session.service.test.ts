import { SessionService } from '../../src/services/session.service';
import { SessionStatus, SessionEventType } from '../../src/types/session.types';
import { AppError } from '../../src/middleware/error.middleware';

describe('SessionService - 7-State Lifecycle & Events', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
  });

  afterEach(() => {
    service.clearAllSessions();
  });

  describe('Session Lifecycle Transitions (7 States)', () => {
    it('1. CREATED: should create a session in CREATED status and record creation event', () => {
      const session = service.createSession({ userId: 'dev-001' });

      expect(session.id).toBeDefined();
      expect(session.status).toBe(SessionStatus.CREATED);

      const events = service.getSessionEvents(session.id);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe(SessionEventType.SESSION_CREATED);
    });

    it('2. ACTIVE: should start a created session into ACTIVE status and emit active event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      const started = service.startSession(session.id);

      expect(started.status).toBe(SessionStatus.ACTIVE);
      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_ACTIVE)).toBe(true);

      // Repeated start is idempotent
      const repeated = service.startSession(session.id);
      expect(repeated.status).toBe(SessionStatus.ACTIVE);
    });

    it('3. PAUSED: should pause an active session and emit pause event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      const paused = service.pauseSession(session.id);

      expect(paused.status).toBe(SessionStatus.PAUSED);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_PAUSED)).toBe(true);
    });

    it('should be IDEMPOTENT when pausing an already paused session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      service.pauseSession(session.id);

      // Repeated pause command
      const repeated = service.pauseSession(session.id);
      expect(repeated.status).toBe(SessionStatus.PAUSED);
    });

    it('should REJECT pausing a session in CREATED status with 409 ILLEGAL_TRANSITION', () => {
      const session = service.createSession({ userId: 'dev-001' });

      expect(() => service.pauseSession(session.id)).toThrow(AppError);
      try {
        service.pauseSession(session.id);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.errorCode).toBe('ILLEGAL_TRANSITION');
      }
    });

    it('should resume a paused session back to ACTIVE and emit resume event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      service.pauseSession(session.id);

      const resumed = service.resumeSession(session.id);
      expect(resumed.status).toBe(SessionStatus.ACTIVE);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_RESUMED)).toBe(true);
    });

    it('should be IDEMPOTENT when resuming an already active session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);

      // Already active, repeated resume command
      const resumed = service.resumeSession(session.id);
      expect(resumed.status).toBe(SessionStatus.ACTIVE);
    });

    it('4 & 5. STOPPING & COMPLETED: should stop an active session, transition through STOPPING to COMPLETED', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      const stopped = service.stopSession(session.id);

      expect(stopped.status).toBe(SessionStatus.COMPLETED);

      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_STOPPING)).toBe(true);
      expect(events.some((e) => e.type === SessionEventType.SESSION_COMPLETED)).toBe(true);

      // Repeated stop command is idempotent
      const repeated = service.stopSession(session.id);
      expect(repeated.status).toBe(SessionStatus.COMPLETED);
    });

    it('should support explicit transition to STOPPING', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      const stopping = service.transitionTo(session.id, SessionStatus.STOPPING);
      expect(stopping.status).toBe(SessionStatus.STOPPING);
    });

    it('6. FAILED: should fail a session and emit failed event', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      const failed = service.failSession(session.id, 'Audio stream lost');

      expect(failed.status).toBe(SessionStatus.FAILED);
      const events = service.getSessionEvents(session.id);
      expect(events.some((e) => e.type === SessionEventType.SESSION_FAILED)).toBe(true);

      // Repeated fail is idempotent
      const repeated = service.failSession(session.id);
      expect(repeated.status).toBe(SessionStatus.FAILED);
    });

    it('should REJECT illegal transitions from COMPLETED terminal state with 409 ILLEGAL_TRANSITION', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      service.stopSession(session.id);

      expect(() => service.pauseSession(session.id)).toThrow(AppError);
      expect(() => service.resumeSession(session.id)).toThrow(AppError);
      expect(() => service.startSession(session.id)).toThrow(AppError);

      try {
        service.resumeSession(session.id);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.errorCode).toBe('ILLEGAL_TRANSITION');
      }
    });

    it('should REJECT illegal transitions from FAILED terminal state', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      service.failSession(session.id);

      expect(() => service.resumeSession(session.id)).toThrow(AppError);
      expect(() => service.pauseSession(session.id)).toThrow(AppError);
    });

    it('should REJECT context updates on a completed session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.startSession(session.id);
      service.stopSession(session.id);

      expect(() =>
        service.updateSessionContext(session.id, { activeApplication: 'VSCode' })
      ).toThrow(AppError);
    });
  });

  describe('7. EXPIRED: Session Inactivity Expiry', () => {
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

    it('should REJECT illegal transitions on EXPIRED terminal session', () => {
      const session = service.createSession({ userId: 'dev-001' });
      service.checkAndExpireSessions(0);

      expect(() => service.pauseSession(session.id)).toThrow(AppError);
      expect(() => service.resumeSession(session.id)).toThrow(AppError);
    });
  });

  describe('Event Streaming & Replay', () => {
    it('should stream events in order and notify real-time subscribers', (done) => {
      const session = service.createSession({ userId: 'dev-001', autoStart: true });
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
