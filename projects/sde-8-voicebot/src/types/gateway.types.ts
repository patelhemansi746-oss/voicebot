export type GatewayModuleType = 'audio' | 'transcription' | 'reasoning' | 'workflow';

export type GatewayModuleStatus = 'UP' | 'DOWN' | 'DEGRADED';

export interface ModuleHealth {
  module: GatewayModuleType;
  status: GatewayModuleStatus;
  mode: 'mock' | 'live';
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface AggregatedHealthData {
  status: 'UP' | 'READY' | 'DEGRADED' | 'DOWN';
  uptime: number;
  timestamp: string;
  modules: Record<GatewayModuleType, ModuleHealth>;
  activeSessions: number;
}

// Audio Gateway Types
export interface AudioInputPayload {
  format?: 'pcm16' | 'wav' | 'mp3' | 'opus';
  sampleRate?: number;
  channels?: number;
  chunkBase64?: string;
  durationMs?: number;
  mockPrompt?: string;
}

export interface AudioProcessingResult {
  audioId: string;
  format: string;
  sampleRate: number;
  durationMs: number;
  sizeBytes: number;
  status: 'captured' | 'processed';
  timestamp: string;
}

// Transcription Gateway Types
export interface TranscriptionResult {
  transcriptId: string;
  audioId: string;
  text: string;
  confidence: number;
  detectedLanguage: string;
  durationMs: number;
  timestamp: string;
}

// Reasoning Gateway Types
export type UserIntent =
  | 'QUERY'
  | 'EXPLAIN_CODE'
  | 'EXPLAIN_SCREEN'
  | 'EXECUTE_TOOL'
  | 'NAVIGATE'
  | 'GENERAL_CONVERSATION';

export interface ReasoningResult {
  reasoningId: string;
  transcriptId: string;
  intent: UserIntent;
  confidence: number;
  thoughtPlan: string[];
  toolRequired?: {
    toolName: string;
    parameters: Record<string, unknown>;
    riskLevel: 'A_INFORMATIONAL' | 'B_LOW_RISK' | 'C_SENSITIVE' | 'D_DESTRUCTIVE';
    requiresApproval: boolean;
  };
  suggestedResponse: string;
  timestamp: string;
}

// Workflow Gateway Types
export interface ToolExecutionRequest {
  toolName: string;
  parameters: Record<string, unknown>;
  riskLevel?: 'A_INFORMATIONAL' | 'B_LOW_RISK' | 'C_SENSITIVE' | 'D_DESTRUCTIVE';
  humanApproved?: boolean;
}

export interface ToolExecutionResult {
  executionId: string;
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  approvedBy?: 'AUTO' | 'HUMAN' | 'POLICY';
  timestamp: string;
}

// End-to-End Interaction Result
export interface SessionInteractionRequest {
  audio?: AudioInputPayload;
  promptText?: string;
  humanApproved?: boolean;
  approvalId?: string;
}

export interface SessionInteractionResult {
  sessionId: string;
  audioResult?: AudioProcessingResult;
  transcriptionResult: TranscriptionResult;
  reasoningResult: ReasoningResult;
  workflowResult?: ToolExecutionResult;
  finalResponse: string;
  durationMs: number;
  correlationId: string;
  requestId: string;
  timestamp: string;
}
