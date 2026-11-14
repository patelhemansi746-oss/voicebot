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

const TERMINAL_STATUSES = new Set<SessionStatus>([
  SessionStatus.COMPLETED,
  SessionStatus.FAILED,
  SessionStatus.EXPIRED
]);

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
   * Create a new voicebot session (Initial status: CREATED, or ACTIVE if autoStart is requested)
   */
  public createSession(dto: CreateSessionDto): VoiceSession {
    // Check expiry on active sessions before creating new ones
    this.checkAndExpireSessions();

    if (this.sessions.size >= env.MAX_CONCURRENT_SESSIONS) {
      throw new AppError('Max concurrent sessions reached', 429, 'MAX_SESSIONS_EXCEEDED', undefined, true);
    }

    const now = new Date().toISOString();
    const sessionId = uuidv4();
    const initialStatus = dto.autoStart ? SessionStatus.ACTIVE : SessionStatus.CREATED;

    const newSession: VoiceSession = {
      id: sessionId,
      userId: dto.userId,
      status: initialStatus,
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

    if (initialStatus === SessionStatus.ACTIVE) {
      this.recordEvent(sessionId, SessionEventType.SESSION_ACTIVE, {
        status: newSession.status
      });
    }

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
   * Start a session (CREATED -> ACTIVE)
   */
  public startSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    // Idempotent: already active
    if (session.status === SessionStatus.ACTIVE) {
      return session;
    }

    if (TERMINAL_STATUSES.has(session.status) || session.status === SessionStatus.STOPPING) {
      throw new AppError(
        `Cannot start session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
      );
    }

    const now = new Date().toISOString();
    session.status = SessionStatus.ACTIVE;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_ACTIVE, { status: session.status });
    return session;
  }

  /**
   * Pause an active session.
   * - ACTIVE -> PAUSED: transitions and emits event.
   * - PAUSED -> PAUSED: IDEMPOTENT, returns existing session without error.
   * - CREATED -> ILLEGAL_TRANSITION (session not started yet).
   * - Terminal states / STOPPING -> ILLEGAL_TRANSITION rejected with 409.
   */
  public pauseSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    // Idempotent: repeated pause command on already paused session
    if (session.status === SessionStatus.PAUSED) {
      return session;
    }

    if (session.status === SessionStatus.CREATED) {
      throw new AppError(
        `Cannot pause session '${id}' in 'created' status; must be started first`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
      );
    }

    // Reject illegal transitions from terminal states or stopping
    if (TERMINAL_STATUSES.has(session.status) || session.status === SessionStatus.STOPPING) {
      throw new AppError(
        `Cannot pause session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
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
   * Resume a paused or created session.
   * - PAUSED / CREATED -> ACTIVE: transitions and emits event.
   * - ACTIVE -> ACTIVE: IDEMPOTENT, returns existing session without error.
   * - Terminal states / STOPPING -> ILLEGAL_TRANSITION rejected with 409.
   */
  public resumeSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    // Idempotent: repeated resume command on already active session
    if (session.status === SessionStatus.ACTIVE) {
      return session;
    }

    // Reject illegal transitions
    if (TERMINAL_STATUSES.has(session.status) || session.status === SessionStatus.STOPPING) {
      throw new AppError(
        `Cannot resume session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
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
   * - ACTIVE / PAUSED / CREATED -> STOPPING -> COMPLETED: transitions and emits events.
   * - COMPLETED / STOPPING -> COMPLETED: IDEMPOTENT, returns existing session without error.
   */
  public stopSession(id: string): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    // Idempotent: repeated stop command on already completed session
    if (session.status === SessionStatus.COMPLETED) {
      return session;
    }

    const now = new Date().toISOString();

    // Intermediate transition: STOPPING
    session.status = SessionStatus.STOPPING;
    session.updatedAt = now;
    this.recordEvent(id, SessionEventType.SESSION_STOPPING, { status: session.status });

    // Terminal completion
    session.status = SessionStatus.COMPLETED;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_COMPLETED, { status: session.status });
    return session;
  }

  /**
   * Transition session into failed state
   */
  public failSession(id: string, reason = 'Unrecoverable error occurred'): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    if (session.status === SessionStatus.FAILED) {
      return session;
    }

    if (session.status === SessionStatus.COMPLETED || session.status === SessionStatus.EXPIRED) {
      throw new AppError(
        `Cannot fail session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
      );
    }

    const now = new Date().toISOString();
    session.status = SessionStatus.FAILED;
    session.updatedAt = now;
    session.lastActivity = now;

    this.recordEvent(id, SessionEventType.SESSION_FAILED, { status: session.status, reason });
    return session;
  }

  /**
   * Transition to explicit intermediate status (e.g. STOPPING for graceful teardown)
   */
  public transitionTo(id: string, targetStatus: SessionStatus): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    if (session.status === targetStatus) {
      return session;
    }

    if (TERMINAL_STATUSES.has(session.status)) {
      throw new AppError(
        `Cannot transition session '${id}' from terminal status '${session.status}' to '${targetStatus}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
      );
    }

    const now = new Date().toISOString();
    session.status = targetStatus;
    session.updatedAt = now;
    session.lastActivity = now;

    let eventType: SessionEventType;
    switch (targetStatus) {
      case SessionStatus.ACTIVE:
        eventType = SessionEventType.SESSION_ACTIVE;
        break;
      case SessionStatus.PAUSED:
        eventType = SessionEventType.SESSION_PAUSED;
        break;
      case SessionStatus.STOPPING:
        eventType = SessionEventType.SESSION_STOPPING;
        break;
      case SessionStatus.COMPLETED:
        eventType = SessionEventType.SESSION_COMPLETED;
        break;
      case SessionStatus.FAILED:
        eventType = SessionEventType.SESSION_FAILED;
        break;
      case SessionStatus.EXPIRED:
        eventType = SessionEventType.SESSION_EXPIRED;
        break;
      default:
        eventType = SessionEventType.SESSION_CREATED;
    }

    this.recordEvent(id, eventType, { status: session.status });
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
      if (
        session.status === SessionStatus.CREATED ||
        session.status === SessionStatus.ACTIVE ||
        session.status === SessionStatus.PAUSED
      ) {
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
   * Update screen / application context for a session
   */
  public updateSessionContext(id: string, contextDto: UpdateSessionContextDto): VoiceSession {
    const session = this.getSessionById(id);
    if (!session) {
      throw new AppError(`Session with ID '${id}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    if (TERMINAL_STATUSES.has(session.status) || session.status === SessionStatus.STOPPING) {
      throw new AppError(
        `Cannot update context for session '${id}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
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
      throw new AppError(`Session with ID '${sessionId}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
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
