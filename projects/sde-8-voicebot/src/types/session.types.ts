import { z } from 'zod';

export enum SessionStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  IDLE = 'idle',
  TERMINATED = 'terminated'
}

export interface SessionContext {
  activeApplication?: string;
  windowTitle?: string;
  documentType?: string;
  visibleContentSnippet?: string;
  lastUpdated: string;
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
  userId: z.string().min(1, 'userId is required'),
  initialContext: z
    .object({
      activeApplication: z.string().optional(),
      windowTitle: z.string().optional(),
      documentType: z.string().optional(),
      visibleContentSnippet: z.string().optional()
    })
    .optional(),
  metadata: z.record(z.unknown()).optional().default({})
});

export const updateSessionStatusSchema = z.object({
  status: z.nativeEnum(SessionStatus)
});

export const updateSessionContextSchema = z.object({
  activeApplication: z.string().optional(),
  windowTitle: z.string().optional(),
  documentType: z.string().optional(),
  visibleContentSnippet: z.string().optional()
});

export type CreateSessionDto = z.infer<typeof createSessionSchema>;
export type UpdateSessionStatusDto = z.infer<typeof updateSessionStatusSchema>;
export type UpdateSessionContextDto = z.infer<typeof updateSessionContextSchema>;

