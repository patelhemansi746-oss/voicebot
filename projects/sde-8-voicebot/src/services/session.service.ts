import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  VoiceSession,
  SessionStatus,
  SessionEvent,
  SessionEventType,
  CreateSessionDto,
  UpdateSessionContextDto
} from '../types/session.types';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';

export class SessionService extends EventEmitter {
  private sessions: Map<string, VoiceSession> = new Map();
  private eventStore: Map<string, SessionEvent[]> = new Map();

  constructor() {
    super();
    // Allow multiple concurrent listeners for SSE streams
    this.setMaxListeners(100);
  }

  /**
   * Helper to append an event to the session event history and emit it in real-time
   */
  private recordEvent(sessionId: string, type: SessionEventType, payload?: Record<string, unknown>): SessionEvent {
    const event: SessionEvent = {
      id: uuidv4(),
      sessionId,
      type,
      timestamp: new Date().toISOString(),
      payload
    };

    const history = this.eventStore.get(sessionId) || [];
    history.push(event);
    this.eventStore.set(sessionId, history);

    // Emit event for real-time SSE subscribers
    this.emit(`session:${sessionId}:event`, event);
    return event;
  }

  /**
   * Create a new voicebot session (Initial status: ACTIVE)
   */
  public createSession(dto: CreateSessionDto): VoiceSession {
    // Check expiry on active sessions before creating new ones
    this.checkAndExpireSessions();

    if (this.sessions.size >= env.MAX_CONCURRENT_SESSIONS) {
      throw new AppError('Max concurrent sessions reached', 429, 'MAX_SESSIONS_EXCEEDED');
    }

    const now = new Date().toISOString();
    const sessionId = uuidv4();

    const newSession: VoiceSession = {
      id: sessionId,
      userId: dto.userId,
      status: SessionStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      lastActivity: now,
      context: {
        activeApplication: dto.initialContext?.activeApplication || 'None',
        windowTitle: dto.initialContext?.windowTitle || 'Desktop',
        documentType: dto.initialContext?.documentType || 'general',
        visibleContentSnippet: dto.initialContext?.visibleContentSnippet || '',
        lastUpdated: now
      },
      metadata: dto.metadata || {}
    };

    this.sessions.set(sessionId, newSession);
    this.eventStore.set(sessionId, []);

    // Record session creation event
    this.recordEvent(sessionId, SessionEventType.SESSION_CREATED, {
      userId: newSession.userId,
      status: newSession.status
    });

    return newSession;
  }

  /**
   * Retrieve all sessions with pagination
   */
  public getAllSessions(page = 1, limit = 20): { sessions: VoiceSession[]; total: number } {
    this.checkAndExpireSessions();
    const all = Array.from(this.sessions.values());
    const startIndex = (page - 1) * limit;
    const paginated = all.slice(startIndex, startIndex + limit);

    return {
      sessions: paginated,
      total: all.length
    };
  }

  /**
   * Get single session by ID (refreshes lastActivity if active/paused)
   */
  public getSessionById(id: string): VoiceSession | null {
    this.checkAndExpireSessions();
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.status === SessionStatus.ACTIVE || session.status === SessionStatus.PAUSED) {
      session.lastActivity = new Date().toISOString();
    }
    return session;
  }

  /**
   * Pause an active session.
   * - ACTIVE -> PAUSED: transitions and emits event.
   * - PAUSED -> PAUSED: IDEMPOTENT, returns existing session without error.
   * - STOPPED or EXPIRED -> ILLEGAL_TRANSITION rejected with 409.
   */
  public pauseSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
    }

    // Idempotent: repeated pause command on already paused session
    if (session.status === SessionStatus.PAUSED) {
      return session;
    }

    // Reject illegal transitions from terminal states
    if (session.status === SessionStatus.STOPPED || session.status === SessionStatus.EXPIRED) {
      throw new AppError(
        `Cannot pause session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    session.status = SessionStatus.PAUSED;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_PAUSED, { status: session.status });
    return session;
  }

  /**
   * Resume a paused session.
   * - PAUSED -> ACTIVE: transitions and emits event.
   * - ACTIVE -> ACTIVE: IDEMPOTENT, returns existing session without error.
   * - STOPPED or EXPIRED -> ILLEGAL_TRANSITION rejected with 409.
   */
  public resumeSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
    }

    // Idempotent: repeated resume command on already active session
    if (session.status === SessionStatus.ACTIVE) {
      return session;
    }

    // Reject illegal transitions
    if (session.status === SessionStatus.STOPPED || session.status === SessionStatus.EXPIRED) {
      throw new AppError(
        `Cannot resume session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    session.status = SessionStatus.ACTIVE;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_RESUMED, { status: session.status });
    return session;
  }

  /**
   * Stop/terminate a session.
   * - ACTIVE / PAUSED -> STOPPED: transitions and emits event.
   * - STOPPED -> STOPPED: IDEMPOTENT, returns existing session without error.
   * - EXPIRED -> STOPPED: IDEMPOTENT or returns existing session.
   */
  public stopSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
    }

    // Idempotent: repeated stop command
    if (session.status === SessionStatus.STOPPED) {
      return session;
    }

    const now = new Date().toISOString();
    session.status = SessionStatus.STOPPED;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_STOPPED, { status: session.status });
    return session;
  }

  /**
   * Check and transition expired sessions based on inactivity timeout
   */
  public checkAndExpireSessions(customTimeoutMinutes?: number): number {
    const timeoutMinutes = customTimeoutMinutes ?? env.SESSION_TIMEOUT_MINUTES;
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const now = Date.now();
    let expiredCount = 0;

    for (const session of this.sessions.values()) {
      if (session.status === SessionStatus.ACTIVE || session.status === SessionStatus.PAUSED) {
        const lastActiveTime = new Date(session.lastActivity).getTime();
        if (now - lastActiveTime >= timeoutMs) {
          const isoNow = new Date().toISOString();
          session.status = SessionStatus.EXPIRED;
          session.updatedAt = isoNow;
          this.recordEvent(session.id, SessionEventType.SESSION_EXPIRED, {
            status: session.status,
            reason: `Inactivity timeout of ${timeoutMinutes} minutes exceeded`
          });
          expiredCount++;
        }
      }
    }

    return expiredCount;
  }

  /**
   * Update screen / application context for an active session
   */
  public updateSessionContext(id: string, contextDto: UpdateSessionContextDto): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND');
    }

    if (session.status === SessionStatus.STOPPED || session.status === SessionStatus.EXPIRED) {
      throw new AppError(
        `Cannot update context for session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION'
      );
    }

    const now = new Date().toISOString();
    session.context = {
      activeApplication: contextDto.activeApplication ?? session.context.activeApplication,
      windowTitle: contextDto.windowTitle ?? session.context.windowTitle,
      documentType: contextDto.documentType ?? session.context.documentType,
      visibleContentSnippet: contextDto.visibleContentSnippet ?? session.context.visibleContentSnippet,
      lastUpdated: now
    };
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.CONTEXT_UPDATED, { context: session.context });
    return session;
  }

  /**
   * Retrieve historical events in chronological order for SSE replay
   */
  public getSessionEvents(sessionId: string): SessionEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AppError(`Session with ID '${sessionId}' not found`, 404, 'SESSION_NOT_FOUND');
    }
    return this.eventStore.get(sessionId) || [];
  }

  /**
   * Subscribe to real-time events for a session
   */
  public subscribeToSessionEvents(
    sessionId: string,
    listener: (event: SessionEvent) => void
  ): () => void {
    const eventName = `session:${sessionId}:event`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }

  /**
   * Delete session completely (clean up memory & events)
   */
  public deleteSession(id: string): boolean {
    this.eventStore.delete(id);
    return this.sessions.delete(id);
  }

  /**
   * Reset store (used in testing)
   */
  public clearAllSessions(): void {
    this.sessions.clear();
    this.eventStore.clear();
    this.removeAllListeners();
  }
}

export const sessionService = new SessionService();
