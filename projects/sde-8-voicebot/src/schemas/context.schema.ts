import { z } from 'zod';

export const UserRoleSchema = z.enum(['student', 'developer', 'researcher', 'general']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserInfoSchema = z.object({
  userId: z.string().min(1),
  name: z.string().optional(),
  role: UserRoleSchema.default('general'),
  preferences: z.record(z.any()).optional()
});
export type UserInfo = z.infer<typeof UserInfoSchema>;

// =========================================================================
// Real Spec: SourceReference Schema
// Represents origin metadata for any captured or synthetic context artifact
// =========================================================================
export const SourceReferenceSchema = z.object({
  application: z.string().min(1), // e.g. "VS Code", "Acrobat PDF Reader"
  windowTitle: z.string().optional().default(''),
  filePath: z.string().optional(),
  lineNumber: z.number().int().positive().optional(),
  boundingRegion: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  }).optional(),
  capturedAt: z.string().datetime().or(z.date()).or(z.string()),
  isSynthetic: z.boolean().default(true) // Synthetic by default for offline deterministic execution
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

// =========================================================================
// Real Spec: ContextItem Schema
// Atomic context payload ingested into the reasoning pipeline
// =========================================================================
export const ContextItemTypeSchema = z.enum([
  'screen_ocr',
  'active_window',
  'user_speech',
  'file_content',
  'synthetic_frame',
  'clipboard',
  'system_log'
]);
export type ContextItemType = z.infer<typeof ContextItemTypeSchema>;

export const ContextItemSchema = z.object({
  id: z.string().min(1),
  source: SourceReferenceSchema,
  type: ContextItemTypeSchema.default('screen_ocr'),
  content: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  isSynthetic: z.boolean().default(true),
  metadata: z.record(z.any()).optional().default({})
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ApplicationContextSchema = z.object({
  application: z.string().min(1), // e.g. "VS Code", "Chrome", "Excel"
  windowTitle: z.string().optional(),
  filePath: z.string().optional(),
  currentWorkflow: z.string().optional()
});
export type ApplicationContext = z.infer<typeof ApplicationContextSchema>;

export const ScreenContextSchema = z.object({
  rawOcrText: z.string(),
  activeRegion: z.string().optional(),
  capturedAt: z.string().datetime().or(z.date()).or(z.string()),
  sanitized: z.boolean().optional(),
  isSynthetic: z.boolean().optional()
});
export type ScreenContext = z.infer<typeof ScreenContextSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime().or(z.date()).or(z.string())
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const AggregatedContextSchema = z.object({
  sessionId: z.string().min(1),
  user: UserInfoSchema,
  application: ApplicationContextSchema,
  screen: ScreenContextSchema,
  contextItems: z.array(ContextItemSchema).optional().default([]),
  history: z.array(ChatMessageSchema).default([]),
  userQuery: z.string().min(1),
  createdAt: z.string().datetime().or(z.date()).or(z.string())
});
export type AggregatedContext = z.infer<typeof AggregatedContextSchema>;
