/**
 * Reasoning Proposal Schemas & Types
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { WorkflowPlan } from './workflow.js';
import { RiskLevel } from './safety.js';

export interface WorkflowProposal {
  proposalId: string;
  sessionId: string;
  rawVoiceInput?: string;
  transcription?: string;
  intent: string;
  confidence: number; // 0.0 - 1.0
  proposedPlan: WorkflowPlan;
  explanation: string;
  riskAssessment: {
    highestRiskLevel: RiskLevel;
    requiresApproval: boolean;
    reasons: string[];
  };
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ProposalEvaluationResult {
  accepted: boolean;
  proposalId: string;
  validationErrors?: string[];
  plan: WorkflowPlan;
  requiresApproval: boolean;
}
