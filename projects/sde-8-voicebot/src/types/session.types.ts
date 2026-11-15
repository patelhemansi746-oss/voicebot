import { z } from 'zod';

export enum SessionStatus {
  CREATED = 'created',
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

// Retain STOPPED alias pointing to COMPLETED for backwards compatibility
(SessionStatus as any).STOPPED = SessionStatus.COMPLETED;

export enum SessionEventType {
  SESSION_CREATED = 'session.created',
  SESSION_ACTIVE = 'session.active',
  SESSION_PAUSED = 'session.paused',
  SESSION_RESUMED = 'session.resumed',
  SESSION_STOPPING = 'session.stopping',
  SESSION_COMPLETED = 'session.completed',
  SESSION_FAILED = 'session.failed',
  SESSION_EXPIRED = 'session.expired',
  CONTEXT_UPDATED = 'context.updated',
  // Week 3 Pipeline Event Types
  AUDIO_INGESTED = 'audio.ingested',
  TRANSCRIPTION_COMPLETED = 'transcription.completed',
  REASONING_COMPLETED = 'reasoning.completed',
  TOOL_APPROVAL_REQUIRED = 'tool.approval_required',
  TOOL_EXECUTING = 'tool.executing',
  TOOL_COMPLETED = 'tool.completed',
  INTERACTION_COMPLETED = 'interaction.completed'
}

// Retain SESSION_STOPPED alias for backwards compatibility
(SessionEventType as any).SESSION_STOPPED = SessionEventType.SESSION_COMPLETED;

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
  sequenceNumber: number; // Monotonically increasing sequence per session
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
  metadata: z.record(z.unknown()).optional(),
  autoStart: z.boolean().optional()
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

export const interactSessionSchema = z.object({
  audio: z
    .object({
      format: z.enum(['pcm16', 'wav', 'mp3', 'opus']).optional(),
      sampleRate: z.number().int().positive().optional(),
      channels: z.number().int().positive().optional(),
      chunkBase64: z.string().optional(),
      durationMs: z.number().positive().optional(),
      mockPrompt: z.string().max(5000).optional()
    })
    .optional(),
  promptText: z.string().max(5000).optional(),
  humanApproved: z.boolean().optional(),
  approvalId: z.string().optional()
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
  autoStart?: boolean;
}

export type UpdateSessionStatusDto = z.infer<typeof updateSessionStatusSchema>;
export type UpdateSessionContextDto = z.infer<typeof updateSessionContextSchema>;
export type InteractSessionDto = z.infer<typeof interactSessionSchema>;
