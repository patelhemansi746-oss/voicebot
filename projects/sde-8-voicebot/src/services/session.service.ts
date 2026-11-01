import { v4 as uuidv4 } from 'uuid';
import {
  VoiceSession,
  SessionStatus,
  CreateSessionDto,
  UpdateSessionContextDto
} from '../types/session.types';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';

export class SessionService {
  private sessions: Map<string, VoiceSession> = new Map();

  /**
   * Create a new mock voicebot session
   */
  public createSession(dto: CreateSessionDto): VoiceSession {
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
    return newSession;
  }

  /**
   * Retrieve all sessions with pagination
   */
  public getAllSessions(page = 1, limit = 20): { sessions: VoiceSession[]; total: number } {
    const all = Array.from(this.sessions.values());
    const startIndex = (page - 1) * limit;
    const paginated = all.slice(startIndex, startIndex + limit);

    return {
      sessions: paginated,
      total: all.length
    };
  }

  /**
   * Get single session by ID
   */
  public getSessionById(id: string): VoiceSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    // Refresh last activity
    session.lastActivity = new Date().toISOString();
    return session;
  }

  /**
   * Update session status
   */
  public updateSessionStatus(id: string, status: SessionStatus): VoiceSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const now = new Date().toISOString();
    session.status = status;
    session.updatedAt = now;
    session.lastActivity = now;

    return session;
  }

  /**
   * Update screen / application context for an active session
   */
  public updateSessionContext(id: string, contextDto: UpdateSessionContextDto): VoiceSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

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

    return session;
  }

  /**
   * Delete / terminate a session
   */
  public deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * Reset store (used in testing)
   */
  public clearAllSessions(): void {
    this.sessions.clear();
  }
}

export const sessionService = new SessionService();

