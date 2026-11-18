/**
 * Reasoning Proposal Manager
 * Ingests, evaluates, and converts reasoning proposals from upstream voice/transcription/reasoning engines
 * into executable, validated Agentic Workflow Plans.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import { EventEmitter } from 'node:events';
import {
  WorkflowProposal,
  ProposalEvaluationResult,
} from '../types/reasoning.js';
import { WorkflowContext, WorkflowResult } from '../types/workflow.js';
import { RiskLevel } from '../types/safety.js';
import { PlanValidator } from '../validation/PlanValidator.js';
import { WorkflowOrchestrator } from '../scheduler/WorkflowOrchestrator.js';

export class ProposalValidationError extends Error {
  constructor(public readonly proposalId: string, public readonly errors: string[]) {
    super(`Reasoning proposal '${proposalId}' was rejected: ${errors.join('; ')}`);
    this.name = 'ProposalValidationError';
  }
}

export class ProposalManager extends EventEmitter {
  private validator: PlanValidator;
  private proposals: Map<string, WorkflowProposal> = new Map();

  constructor(validator?: PlanValidator) {
    super();
    this.validator = validator ?? new PlanValidator();
  }

  public getValidator(): PlanValidator {
    return this.validator;
  }

  /**
   * Register a proposal received from the reasoning engine
   */
  public registerProposal(proposal: WorkflowProposal): void {
    this.proposals.set(proposal.proposalId, proposal);
    this.emit('proposalRegistered', proposal);
  }

  public getProposal(proposalId: string): WorkflowProposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Evaluate a proposal: validates plan acyclicity, dependencies, and allow-listed tools,
   * and computes risk level & approval requirements.
   */
  public evaluateProposal(proposal: WorkflowProposal): ProposalEvaluationResult {
    const planValidation = this.validator.validate(proposal.proposedPlan);

    let highestRisk: RiskLevel = RiskLevel.A_INFORMATIONAL;
    let requiresApproval = false;

    for (const step of proposal.proposedPlan.steps) {
      const risk = step.riskLevel ?? RiskLevel.A_INFORMATIONAL;
      if (risk > highestRisk) {
        highestRisk = risk;
      }
      if (risk === RiskLevel.C_SENSITIVE || risk === RiskLevel.D_HIGH_RISK_DESTRUCTIVE) {
        requiresApproval = true;
      }
    }

    const accepted = planValidation.isValid;
    const errors = planValidation.errors.map((e) => `[${e.code}] ${e.message}`);

    const result: ProposalEvaluationResult = {
      accepted,
      proposalId: proposal.proposalId,
      validationErrors: errors.length > 0 ? errors : undefined,
      plan: proposal.proposedPlan,
      requiresApproval: requiresApproval || proposal.riskAssessment.requiresApproval,
    };

    this.emit('proposalEvaluated', { proposal, result });
    return result;
  }

  /**
   * Construct a standard WorkflowContext from a reasoning proposal
   */
  public createContextFromProposal(proposal: WorkflowProposal): WorkflowContext {
    return {
      workflowId: proposal.proposedPlan.id,
      name: proposal.proposedPlan.name,
      userRequest: {
        requestId: `req_${proposal.proposalId}`,
        sessionId: proposal.sessionId,
        rawVoiceInput: proposal.rawVoiceInput,
        transcription: proposal.transcription,
        intent: proposal.intent,
        timestamp: proposal.timestamp,
      },
      appContext: {
        activeApplication: 'VS Code - Academia AI Co-Pilot',
        windowTitle: 'Workspace Buffer',
        visibleContent: proposal.explanation,
      },
      stepResults: {},
      variables: {},
      attemptsPerStep: {},
      approvals: {},
      logs: [],
      startTime: Date.now(),
    };
  }

  /**
   * Validate and execute a proposal end-to-end
   */
  public async executeProposal(
    proposal: WorkflowProposal,
    orchestrator: WorkflowOrchestrator
  ): Promise<WorkflowResult> {
    this.registerProposal(proposal);
    const evaluation = this.evaluateProposal(proposal);

    if (!evaluation.accepted) {
      throw new ProposalValidationError(proposal.proposalId, evaluation.validationErrors || []);
    }

    const context = this.createContextFromProposal(proposal);
    return orchestrator.executeWorkflow(proposal.proposedPlan, context);
  }
}
