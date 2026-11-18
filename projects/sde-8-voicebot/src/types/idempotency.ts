/**
 * Idempotency Key Types
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

export interface IdempotencyRecord {
  key: string;
  toolName: string;
  stepId?: string;
  workflowId?: string;
  parameters: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  executionCount: number;
}
