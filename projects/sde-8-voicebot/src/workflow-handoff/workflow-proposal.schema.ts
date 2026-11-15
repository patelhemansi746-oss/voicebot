import { z } from 'zod';
import { RiskLevelSchema, UserIntentSchema } from '../schemas/reasoning.schema';

export const WorkflowStepTypeSchema = z.enum([
  'OBSERVATION',
  'REASONING',
  'PLANNING',
  'TOOL_EXECUTION',
  'VERIFICATION',
  'RESPONSE',
  'HUMAN_APPROVAL'
]);
export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>;

export const WorkflowProposalStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: WorkflowStepTypeSchema,
  description: z.string(),
  toolName: z.string().optional(),
  toolParameters: z.record(z.any()).optional(),
  riskLevel: RiskLevelSchema.default('A'),
  requiresApproval: z.boolean().default(false)
});
export type WorkflowProposalStep = z.infer<typeof WorkflowProposalStepSchema>;

export const WorkflowProposalTransitionSchema = z.object({
  fromStepId: z.string().min(1),
  toStepId: z.string().min(1),
  isDefault: z.boolean().optional().default(true),
  label: z.string().optional()
});
export type WorkflowProposalTransition = z.infer<typeof WorkflowProposalTransitionSchema>;

/**
 * Formal Schema for WorkflowProposal (Week 3 - Days 19–20)
 * 
 * Defines the contract passed from the Context & Reasoning Engine
 * into the Agentic Workflow Orchestrator module.
 */
export const WorkflowProposalSchema = z.object({
  proposalId: z.string().min(1),
  workflowId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  intent: UserIntentSchema.default('MULTI_STEP_TASK'),
  initialStepId: z.string().min(1),
  steps: z.array(WorkflowProposalStepSchema).min(1),
  transitions: z.array(WorkflowProposalTransitionSchema),
  riskLevel: RiskLevelSchema.default('A'),
  requiresApproval: z.boolean().default(false),
  suggestedBy: z.literal('reasoning_engine').default('reasoning_engine'),
  createdAt: z.string().datetime().or(z.string()),
  status: z.enum(['PROPOSED', 'VALIDATED', 'ACCEPTED', 'EXECUTED', 'REJECTED']).default('PROPOSED')
});
export type WorkflowProposal = z.infer<typeof WorkflowProposalSchema>;
