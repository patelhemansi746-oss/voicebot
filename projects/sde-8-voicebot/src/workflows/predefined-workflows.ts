/**
 * Predefined Workflows Implemented with the Two Standard Harmless Tools
 * Using 'calculator' and 'summarize_text' to demonstrate multi-step reasoning and safety gate
 */

import { WorkflowPlan } from '../types/workflow.js';
import { RiskLevel } from '../types/safety.js';
import { WorkflowBuilder } from './WorkflowBuilder.js';

/**
 * Multi-Step Reasoning Workflow:
 * Computes numerical metrics via 'calculator' and generates an executive summary via 'summarize_text'.
 */
export function createCalculationAndSummaryWorkflow(): WorkflowPlan {
  return new WorkflowBuilder('wf_calc_summarize', 'Calculation & Summarization Workflow', 'Calculates metrics and synthesizes structured summary')
    .addObservationStep('obs_1', 'Gather Voice & Context Data')
    .addReasoningStep('rsn_1', 'Formulate Computational & Analytical Plan')
    .addPlanningStep('pln_1', 'Decompose into Calculate -> Summarize Steps')
    .addToolStep('step_calc', 'Calculate Key Metrics', 'calculator', {
      expression: '(25 * 4) + 150',
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      outputVariable: 'calcResult',
      retryPolicy: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2 },
    })
    .addToolStep('step_summarize', 'Synthesize Executive Summary', 'summarize_text', (ctx) => {
      const calcRes = ctx.variables.calcResult as { result?: number } | undefined;
      const total = calcRes?.result ?? 250;
      return {
        text: `Analysis complete. Total computed score is ${total}. System performance is within optimal bounds.`,
        maxPoints: 3,
        focus: 'Key outcomes and recommendations',
      };
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      outputVariable: 'summaryReport',
    })
    .addVerificationStep('ver_1', 'Verify Summary Quality and Completeness')
    .addResponseStep('resp_1', 'Deliver Voice & UI Summary to User')
    .addSequentialTransitions()
    .build();
}

/**
 * Controlled Action Workflow:
 * Demonstrates Safety Gate with Human-in-the-Loop approval for sensitive / high-risk operations.
 */
export function createControlledActionWorkflow(): WorkflowPlan {
  return new WorkflowBuilder('wf_controlled_action', 'Controlled Action Workflow', 'Executes sensitive action with explicit human safety gate')
    .addObservationStep('obs_1', 'Observe Environment Context')
    .addReasoningStep('rsn_1', 'Verify Action Boundaries')
    .addToolStep('step_action', 'Execute High-Risk Action', 'summarize_text', {
      text: 'Authorize permanent modification of production parameters',
      maxPoints: 2,
    }, {
      riskLevel: RiskLevel.D_HIGH_RISK_DESTRUCTIVE, // Requires explicit user approval
      outputVariable: 'actionResult',
      fallbackAction: {
        type: 'DEFAULT_OUTPUT',
        defaultOutput: { approved: false, reason: 'User denied authorization' },
      },
    })
    .addResponseStep('resp_1', 'Notify User of Action Outcome')
    .addSequentialTransitions()
    .build();
}

/**
 * Text Analysis & Diagnostic Workflow:
 * Uses 'summarize_text' to parse input and formulate recommendations.
 */
export function createTextAnalysisWorkflow(): WorkflowPlan {
  return new WorkflowBuilder('wf_text_analysis', 'Text Analysis Workflow', 'Summarizes technical findings and diagnostic logs')
    .addObservationStep('obs_input', 'Capture Diagnostic Log')
    .addReasoningStep('rsn_analyze', 'Analyze Error Pattern')
    .addToolStep('step_summarize_diag', 'Summarize Diagnostic Report', 'summarize_text', (ctx) => {
      const input = (ctx.stepResults.obs_input as { logText?: string } | undefined)?.logText;
      return {
        text: input ?? 'TypeError: Cannot read properties of undefined in runtime context',
        maxPoints: 2,
        focus: 'Root cause and remediation',
      };
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      outputVariable: 'diagnosticReport',
    })
    .addResponseStep('resp_explanation', 'Deliver Spoken and Visual Explanation')
    .addSequentialTransitions()
    .build();
}

// Backward-compatible aliases
export const createPdfSummarizeWorkflow = createCalculationAndSummaryWorkflow;
export const createControlledFileCleanupWorkflow = createControlledActionWorkflow;
export const createCodeErrorDiagnosisWorkflow = createTextAnalysisWorkflow;

