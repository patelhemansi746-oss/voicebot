import { z } from 'zod';

export enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  EXPIRED = 'expired'
}

export enum SessionEventType {
  SESSION_CREATED = 'session.created',
  SESSION_PAUSED = 'session.paused',
  SESSION_RESUMED = 'session.resumed',
  SESSION_STOPPED = 'session.stopped',
  SESSION_EXPIRED = 'session.expired',
  CONTEXT_UPDATED = 'context.updated'
}

export interface SessionContext {
  activeApplication?: string;
  windowTitle?: string;
  documentType?: string;
  visibleContentSnippet?: string;
  lastUpdated: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface VoiceSession {
  id: string;
  userId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastActivity: string;
  context: SessionContext;
  metadata: Record<string, unknown>;
}

// Zod Validation Schemas
export const createSessionSchema = z.object({
  userId: z.string().min(1, 'userId is required').max(128, 'userId cannot exceed 128 characters'),
  initialContext: z
    .object({
      activeApplication: z.string().max(256).optional(),
      windowTitle: z.string().max(256).optional(),
      documentType: z.string().max(128).optional(),
      visibleContentSnippet: z.string().max(50000, 'visibleContentSnippet cannot exceed 50000 characters').optional()
    })
    .optional(),
  metadata: z.record(z.unknown()).optional()
});

export const updateSessionStatusSchema = z.object({
  status: z.nativeEnum(SessionStatus)
});

export const updateSessionContextSchema = z.object({
  activeApplication: z.string().max(256).optional(),
  windowTitle: z.string().max(256).optional(),
  documentType: z.string().max(128).optional(),
  visibleContentSnippet: z.string().max(50000, 'visibleContentSnippet cannot exceed 50000 characters').optional()
});

export interface CreateSessionDto {
  userId: string;
  initialContext?: {
    activeApplication?: string;
    windowTitle?: string;
    documentType?: string;
    visibleContentSnippet?: string;
  };
  metadata?: Record<string, unknown>;
}

export type UpdateSessionStatusDto = z.infer<typeof updateSessionStatusSchema>;
export type UpdateSessionContextDto = z.infer<typeof updateSessionContextSchema>;
