/**
 * Safety & Human-in-the-Loop Approval Types
 * Academia AI Voice Co-Pilot PRD / SDD Specifications
 */

/**
 * Risk classification levels defined in PRD Section 18
 */
export enum RiskLevel {
  /**
   * Category A — Informational:
   * e.g., Explain document, summarize visible information, answer questions.
   * No human approval required.
   */
  A_INFORMATIONAL = 'A_INFORMATIONAL',

  /**
   * Category B — Low-Risk Interaction:
   * e.g., Search information, open permitted document, read directory.
   * May be executed according to configured auto-approval policy.
   */
  B_LOW_RISK = 'B_LOW_RISK',

  /**
   * Category C — Sensitive:
   * e.g., Send email, modify files, change application settings.
   * Explicit user confirmation required.
   */
  C_SENSITIVE = 'C_SENSITIVE',

  /**
   * Category D — High-Risk / Destructive:
   * e.g., Delete files, run terminal commands, financial or security operations.
   * Explicit double confirmation strictly required; cannot be auto-approved.
   */
  D_HIGH_RISK_DESTRUCTIVE = 'D_HIGH_RISK_DESTRUCTIVE',
}

/**
 * Approval status lifecycle states
 */
export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/**
 * Request for user approval before executing an action
 */
export interface ApprovalRequest {
  approvalId: string;
  workflowId: string;
  stepId: string;
  toolName: string;
  riskLevel: RiskLevel;
  description: string;
  parameters: Record<string, unknown>;
  consequencesSummary: string;
  createdAt: number;
  expiresAt?: number;
  ttlMs?: number;
  status?: ApprovalStatus;
  requiresDoubleConfirmation: boolean;
  confirmationCount?: number;
  rejectionReason?: string;
  decision?: ApprovalDecision;
}

/**
 * Decision submitted by the user or approval policy
 */
export interface ApprovalDecision {
  approvalId: string;
  workflowId: string;
  approved: boolean;
  decidedBy: 'USER' | 'AUTO_POLICY';
  decidedAt: number;
  reason?: string;
}

/**
 * Policy governing safety gates
 */
export interface SafetyPolicy {
  autoApproveLevelA: boolean;
  autoApproveLevelB: boolean;
  autoApproveLevelC: boolean; // default false
  autoApproveLevelD: boolean; // MUST ALWAYS BE FALSE
  allowedToolNames?: string[];
  blockedToolNames?: string[];
  maxDailySensitiveActions?: number;
  defaultApprovalTtlMs?: number;
}
