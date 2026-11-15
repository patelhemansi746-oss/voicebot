import { RiskLevel, UserIntent } from '../schemas/reasoning.schema';

export interface SourceCitation {
  /** Observation ID from which this fact was grounded */
  observationId: string;
  /** Origin application name (e.g. VS Code, Acrobat PDF Reader) */
  application: string;
  /** Window title or file path */
  windowTitle?: string;
  /** Verifiable excerpt from the screen or text */
  quote: string;
  /** Grounding confidence [0..1] */
  confidence: number;
}

export type GroundedAnswerStatus = 'grounded' | 'no_evidence' | 'pending_approval' | 'error';

export interface GroundedAnswer {
  requestId: string;
  sessionId: string;
  status: GroundedAnswerStatus;
  intent: UserIntent;
  /** True only when factual claims are backed by citations */
  evidenceFound: boolean;
  /** Explicit source references and quotes supporting the answer */
  citations: SourceCitation[];
  /** IDs of observations used in reasoning */
  sourcesUsed: string[];
  /** Final formatted answer text citing sources or stating no evidence */
  answerText: string;
  /** Safety risk level (A to D) */
  riskLevel: RiskLevel;
  /** Whether human approval is required */
  requiresApproval: boolean;
  /** Reason description when evidence was not found */
  noEvidenceReason?: string;
  /** Duration in milliseconds */
  durationMs: number;
}
