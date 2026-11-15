import { z } from 'zod';
import { WorkflowProposal, WorkflowProposalSchema } from './workflow-proposal.schema';

export class WorkflowProposalValidationError extends Error {
  public zodErrors: z.ZodIssue[];
  constructor(message: string, zodErrors: z.ZodIssue[]) {
    super(`WorkflowProposal failed schema validation: ${message}`);
    this.name = 'WorkflowProposalValidationError';
    this.zodErrors = zodErrors;
  }
}

export interface WorkflowHandoffResult {
  proposalId: string;
  workflowId: string;
  finalState: 'COMPLETED' | 'AWAITING_APPROVAL' | 'FAILED';
  success: boolean;
  executedSteps: string[];
  stepOutputs: Record<string, any>;
  durationMs: number;
  isMock: boolean;
  handoffTimestamp: string;
}

export interface IWorkflowHandoffAdapter {
  validateProposal(rawProposal: unknown): WorkflowProposal;
  handoff(proposal: WorkflowProposal, options?: { approveLevelC?: boolean }): Promise<WorkflowHandoffResult>;
}

/**
 * MockWorkflowHandoffAdapter (Week 3 - Days 19–20)
 * 
 * Provides end-to-end integration between the Reasoning Engine and the Workflow Orchestrator:
 * 1. Strict schema validation via Zod (WorkflowProposalSchema).
 * 2. Deterministic mock execution traversing workflow steps (Observation -> Reasoning -> Tool Execution -> Verification).
 * 3. Human-in-the-Loop approval gate interception for Level C/D proposals.
 */
export class MockWorkflowHandoffAdapter implements IWorkflowHandoffAdapter {
  /**
   * Validates a raw proposal against the formal Zod schema.
   */
  public validateProposal(rawProposal: unknown): WorkflowProposal {
    const result = WorkflowProposalSchema.safeParse(rawProposal);
    if (!result.success) {
      throw new WorkflowProposalValidationError(result.error.message, result.error.issues);
    }
    return result.data;
  }

  /**
   * Hands off a validated WorkflowProposal to the workflow execution engine in mock mode.
   */
  public async handoff(
    proposal: WorkflowProposal,
    options?: { approveLevelC?: boolean; simulatedLatencyMs?: number }
  ): Promise<WorkflowHandoffResult> {
    const startTime = Date.now();
    const validated = this.validateProposal(proposal);

    // Safety Gate Check: Level C / D requires approval
    if (validated.requiresApproval && !options?.approveLevelC) {
      return {
        proposalId: validated.proposalId,
        workflowId: validated.workflowId,
        finalState: 'AWAITING_APPROVAL',
        success: false,
        executedSteps: [validated.initialStepId],
        stepOutputs: {
          [validated.initialStepId]: {
            status: 'WAITING_FOR_APPROVAL',
            reason: `Workflow contains Level ${validated.riskLevel} action requiring explicit human confirmation.`
          }
        },
        durationMs: Date.now() - startTime,
        isMock: true,
        handoffTimestamp: new Date().toISOString()
      };
    }

    if (options?.simulatedLatencyMs) {
      await new Promise(resolve => setTimeout(resolve, options.simulatedLatencyMs));
    }

    // Execute workflow steps deterministically
    const executedSteps: string[] = [];
    const stepOutputs: Record<string, any> = {};

    let currentStepId: string | undefined = validated.initialStepId;
    const stepMap = new Map(validated.steps.map(s => [s.id, s]));

    while (currentStepId) {
      const step = stepMap.get(currentStepId);
      if (!step) break;

      executedSteps.push(step.id);

      // Simulate step execution based on step type
      stepOutputs[step.id] = {
        stepName: step.name,
        type: step.type,
        executedAt: new Date().toISOString(),
        output: step.toolName ? `Mock output for tool ${step.toolName}` : `Step ${step.name} completed successfully`
      };

      // Follow transition to next step
      const transition = validated.transitions.find(t => t.fromStepId === currentStepId);
      currentStepId = transition ? transition.toStepId : undefined;
    }

    return {
      proposalId: validated.proposalId,
      workflowId: validated.workflowId,
      finalState: 'COMPLETED',
      success: true,
      executedSteps,
      stepOutputs,
      durationMs: Date.now() - startTime,
      isMock: true,
      handoffTimestamp: new Date().toISOString()
    };
  }

  /**
   * Factory method to construct a standard multi-step diagnostic workflow proposal.
   */
  public createStandardDiagnosticProposal(sessionId: string, errorSnippet: string): WorkflowProposal {
    return {
      proposalId: `prop-${Date.now()}-diag`,
      workflowId: `wf-err-diag-${Date.now()}`,
      name: 'Diagnostic & Remediation Workflow',
      description: `Automated investigation and fix proposal for: ${errorSnippet.substring(0, 50)}...`,
      intent: 'EXPLAIN_ERROR',
      initialStepId: 'step-gather-context',
      steps: [
        {
          id: 'step-gather-context',
          name: 'Gather Screen Context',
          type: 'OBSERVATION',
          description: 'Extract active terminal OCR and stack trace',
          riskLevel: 'A',
          requiresApproval: false
        },
        {
          id: 'step-analyze-root-cause',
          name: 'Analyze Root Cause',
          type: 'REASONING',
          description: 'Reason over stack trace using developer persona',
          riskLevel: 'A',
          requiresApproval: false
        },
        {
          id: 'step-propose-fix',
          name: 'Formulate Code Fix',
          type: 'RESPONSE',
          description: 'Synthesize verified defensive fix with null check',
          riskLevel: 'A',
          requiresApproval: false
        }
      ],
      transitions: [
        { fromStepId: 'step-gather-context', toStepId: 'step-analyze-root-cause', isDefault: true },
        { fromStepId: 'step-analyze-root-cause', toStepId: 'step-propose-fix', isDefault: true }
      ],
      riskLevel: 'A',
      requiresApproval: false,
      suggestedBy: 'reasoning_engine',
      createdAt: new Date().toISOString(),
      status: 'PROPOSED'
    };
  }
}
