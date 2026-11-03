import { z } from 'zod';
import { ContextItemSchema } from './context.schema';

export const UserIntentSchema = z.enum([
  'EXPLAIN_SCREEN',
  'EXPLAIN_ERROR',
  'EXPLAIN_DOCUMENT',
  'ANALYZE_SPREADSHEET',
  'RESEARCH_ASSISTANCE',
  'FILE_SEARCH',
  'MULTI_STEP_TASK',
  'CONTROLLED_ACTION',
  'GENERAL_QUERY'
]);
export type UserIntent = z.infer<typeof UserIntentSchema>;

export const RiskLevelSchema = z.enum(['A', 'B', 'C', 'D']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ToolCallSchema = z.object({
  toolName: z.string(),
  parameters: z.record(z.any()),
  riskLevel: RiskLevelSchema,
  requiresApproval: z.boolean(),
  description: z.string()
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// =========================================================================
// Real Spec: ReasoningRequest & ReasoningResult Schemas
// Formal contracts for the Multimodal Context & Reasoning Engine
// =========================================================================

export const ReasoningRequestSchema = z.object({
  sessionId: z.string().min(1),
  userQuery: z.string().min(1),
  contextItems: z.array(ContextItemSchema).optional(),
  promptVersion: z.string().optional(),
  trustedSystemPrompt: z.string().optional(),
  metadata: z.record(z.any()).optional()
});
export type ReasoningRequest = z.infer<typeof ReasoningRequestSchema>;

export const ReasoningResultSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(['completed', 'pending_approval', 'error']).default('completed'),
  intent: UserIntentSchema,
  reasoningText: z.string(),
  toolCall: ToolCallSchema.nullable().default(null),
  requiresApproval: z.boolean().default(false),
  riskLevel: RiskLevelSchema.default('A'),
  sourcesUsed: z.array(z.string()).optional().default([]), // IDs of ContextItems used in reasoning
  executionDurationMs: z.number().optional()
});
export type ReasoningResult = z.infer<typeof ReasoningResultSchema>;

// =========================================================================
// API Interface Contracts (/api/v1/context & /api/v1/ai/chat compatibility)
// =========================================================================

// Contract for /api/v1/context
export const ContextSubmissionRequestSchema = z.object({
  session_id: z.string().optional(),
  application: z.string(),
  screen: z.string(),
  user_query: z.string()
});
export type ContextSubmissionRequest = z.infer<typeof ContextSubmissionRequestSchema>;

export const ContextSubmissionResponseSchema = z.object({
  context_id: z.string(),
  relevant_context: z.string()
});
export type ContextSubmissionResponse = z.infer<typeof ContextSubmissionResponseSchema>;

// Contract for /api/v1/ai/chat
export const ChatRequestSchema = z.object({
  session_id: z.string(),
  message: z.string(),
  context_id: z.string().optional()
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  status: z.enum(['completed', 'pending_approval', 'error']),
  intent: UserIntentSchema,
  response: z.string(),
  tool_call: ToolCallSchema.nullable(),
  requires_approval: z.boolean(),
  risk_level: RiskLevelSchema,
  sources_used: z.array(z.string()).optional().default([])
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const StandardErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string().optional()
  })
});
export type StandardError = z.infer<typeof StandardErrorSchema>;
