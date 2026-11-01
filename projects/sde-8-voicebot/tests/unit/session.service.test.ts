import { SessionService } from '../../src/services/session.service';
import { SessionStatus } from '../../src/types/session.types';
import { AppError } from '../../src/middleware/error.middleware';

describe('SessionService Unit Tests', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService();
  });

  describe('createSession', () => {
    it('should create a valid active session with default context', () => {
      const session = service.createSession({ userId: 'user-123' });

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-123');
      expect(session.status).toBe(SessionStatus.ACTIVE);
      expect(session.context.activeApplication).toBe('None');
      expect(session.context.windowTitle).toBe('Desktop');
    });

    it('should create a session with supplied initial context and metadata', () => {
      const session = service.createSession({
        userId: 'dev-456',
        initialContext: {
          activeApplication: 'VSCode',
          windowTitle: 'app.ts - voicebot',
          documentType: 'typescript',
          visibleContentSnippet: 'console.log("hello");'
        },
        metadata: { role: 'tester' }
      });

      expect(session.context.activeApplication).toBe('VSCode');
      expect(session.context.windowTitle).toBe('app.ts - voicebot');
      expect(session.metadata).toEqual({ role: 'tester' });
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions and paginate correctly', () => {
      service.createSession({ userId: 'u1' });
      service.createSession({ userId: 'u2' });
      service.createSession({ userId: 'u3' });

      const page1 = service.getAllSessions(1, 2);
      expect(page1.sessions.length).toBe(2);
      expect(page1.total).toBe(3);

      const page2 = service.getAllSessions(2, 2);
      expect(page2.sessions.length).toBe(1);
    });
  });

  describe('getSessionById', () => {
    it('should retrieve existing session and update lastActivity', () => {
      const created = service.createSession({ userId: 'u1' });
      const found = service.getSessionById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('should return null for non-existing id', () => {
      const found = service.getSessionById('invalid-id');
      expect(found).toBeNull();
    });
  });

  describe('updateSessionStatus', () => {
    it('should update status to PAUSED or TERMINATED', () => {
      const created = service.createSession({ userId: 'u1' });
      const updated = service.updateSessionStatus(created.id, SessionStatus.PAUSED);

      expect(updated?.status).toBe(SessionStatus.PAUSED);
    });

    it('should return null when updating non-existing session', () => {
      const updated = service.updateSessionStatus('non-existent', SessionStatus.IDLE);
      expect(updated).toBeNull();
    });
  });

  describe('updateSessionContext', () => {
    it('should update context attributes without erasing others', () => {
      const created = service.createSession({
        userId: 'u1',
        initialContext: { activeApplication: 'Chrome', windowTitle: 'PRD' }
      });

      const updated = service.updateSessionContext(created.id, {
        windowTitle: 'GitHub PR'
      });

      expect(updated?.context.activeApplication).toBe('Chrome');
      expect(updated?.context.windowTitle).toBe('GitHub PR');
    });

    it('should return null for non-existing session context update', () => {
      const updated = service.updateSessionContext('non-existent', { activeApplication: 'Vim' });
      expect(updated).toBeNull();
    });
  });

  describe('deleteSession and clearAllSessions', () => {
    it('should delete existing session', () => {
      const created = service.createSession({ userId: 'u1' });
      const deleted = service.deleteSession(created.id);

      expect(deleted).toBe(true);
      expect(service.getSessionById(created.id)).toBeNull();
    });

    it('should return false when deleting non-existing session', () => {
      expect(service.deleteSession('unknown')).toBe(false);
    });

    it('should clear all sessions', () => {
      service.createSession({ userId: 'u1' });
      service.createSession({ userId: 'u2' });
      service.clearAllSessions();

      expect(service.getAllSessions().total).toBe(0);
    });
  });
});

