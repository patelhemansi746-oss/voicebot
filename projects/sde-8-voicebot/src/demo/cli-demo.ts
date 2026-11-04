/**
 * Interactive CLI Live Demo Runner
 * Showcases State Machine, Safety Gate, Mock Tool Executor, and Error Recovery
 */

import { WorkflowOrchestrator } from '../scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import {
  createCalculationAndSummaryWorkflow,
  createControlledActionWorkflow,
} from '../workflows/predefined-workflows.js';
import { WorkflowBuilder } from '../workflows/WorkflowBuilder.js';
import { type WorkflowContext } from '../types/workflow.js';
import { RiskLevel } from '../types/safety.js';

// ANSI formatting helpers
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const green = '\x1b[32m';
const cyan = '\x1b[36m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const magenta = '\x1b[35m';

function banner(text: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`${bold}${cyan}${text}${reset}`);
  console.log('='.repeat(70));
}

function createContext(id: string, query: string, intent: string): WorkflowContext {
  return {
    workflowId: id,
    name: `Demo: ${intent}`,
    userRequest: {
      requestId: `req_${Date.now()}`,
      sessionId: 'session_demo_cli',
      rawVoiceInput: query,
      intent,
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'Voicebot Workspace',
      windowTitle: 'voicebot-agentic-workflow',
      visibleContent: 'Computational data and text context loaded',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

async function runScenario1_CalcSummarize() {
  banner('SCENARIO 1: Multi-Step Reasoning Workflow\n"Compute key project metrics and summarize findings"');

  const executor = new MockToolExecutor();
  const orchestrator = new WorkflowOrchestrator(executor);
  const def = createCalculationAndSummaryWorkflow();
  const ctx = createContext('wf_demo_calc', 'Compute metrics and generate summary', 'calc_and_summarize');

  orchestrator.on('stateTransition', (d) => {
    console.log(`  [State Machine] ${magenta}${d.from}${reset} ──(${d.event})──▶ ${bold}${green}${d.to}${reset}`);
  });

  orchestrator.on('stepStarted', (s) => {
    console.log(`  ${cyan}▶ Starting Step:${reset} ${bold}${s.stepName}${reset} [${s.stepType}]`);
  });

  const result = await orchestrator.executeWorkflow(def, ctx);

  console.log(`\n${bold}${green}✔ Workflow Completed Successfully!${reset}`);
  console.log(`  Final State: ${bold}${result.finalState}${reset}`);
  console.log(`  Execution Time: ${result.durationMs}ms`);
  console.log(`  Executed Steps: ${result.executedSteps.join(' -> ')}`);
  console.log(`  ${bold}Generated Summary:${reset}`, ctx.variables.summaryReport);
}

async function runScenario2_SafetyGateApproval() {
  banner('SCENARIO 2: Safety Gate Human-in-the-Loop Approval\n"Authorize sensitive action" -> Category D Destructive Action');

  const executor = new MockToolExecutor();
  const safetyGate = new SafetyGate();
  const orchestrator = new WorkflowOrchestrator(executor, safetyGate);
  const def = createControlledActionWorkflow();
  const ctx = createContext('wf_demo_safety', 'Execute controlled action', 'controlled_action');

  orchestrator.on('stateTransition', (d) => {
    console.log(`  [State Machine] ${magenta}${d.from}${reset} ──(${d.event})──▶ ${bold}${green}${d.to}${reset}`);
  });

  orchestrator.on('approvalRequested', (req) => {
    console.log(`\n  ${yellow}${bold}⚠️  SAFETY GATE TRIGGERED! [Risk: ${req.riskLevel}]${reset}`);
    console.log(`  Tool: ${bold}${req.toolName}${reset}`);
    console.log(`  Target: ${JSON.stringify(req.parameters)}`);
    console.log(`  Notice: ${req.consequencesSummary}`);
    console.log(`  Double Confirmation Required: ${bold}${req.requiresDoubleConfirmation}${reset}`);
    console.log(`  ${cyan}Simulating User Authorization: [Y/N] -> User approves with explicit token...${reset}\n`);

    setTimeout(() => {
      orchestrator.submitApproval(req.stepId, true, 'User explicitly confirmed in demo CLI');
    }, 400);
  });

  const result = await orchestrator.executeWorkflow(def, ctx);

  console.log(`\n${bold}${green}✔ Workflow Completed with User Authorization!${reset}`);
  console.log(`  Final State: ${bold}${result.finalState}${reset}`);
  console.log(`  Step Results:`, ctx.stepResults.step_action);
}

async function runScenario3_TransientFailureAndExponentialBackoff() {
  banner('SCENARIO 3: Fault Tolerance & Exponential Backoff Recovery\nSimulating 2 consecutive transient timeouts before recovery');

  const executor = new MockToolExecutor();
  executor.configureMock('calculator', {
    failNTimes: 2,
    failureErrorCode: 'TRANSIENT_COMPUTE_BUSY',
    failureErrorMessage: 'Simulated temporary engine busy error',
  });

  const orchestrator = new WorkflowOrchestrator(executor);
  orchestrator.getRecoveryEngine().on('retryAttempt', (ev) => {
    console.log(`  ${yellow}⚡ Retry Engine:${reset} Step '${ev.stepId}' failed (${ev.error.message}). Backing off for ${ev.delayMs}ms (Attempt ${ev.attempt}/${ev.maxAttempts})`);
  });

  const builder = new WorkflowBuilder('wf_demo_retry', 'Retry Demo')
    .addReasoningStep('step_rsn', 'Reasoning about computation')
    .addPlanningStep('step_pln', 'Planning tool call')
    .addToolStep('step_calc', 'Calculate Result', 'calculator', { expression: '125 * 8' }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      retryPolicy: { maxAttempts: 3, backoffMs: 80, backoffMultiplier: 2 },
    })
    .addResponseStep('step_resp', 'Formulate Response')
    .addSequentialTransitions();

  const ctx = createContext('wf_demo_retry', 'Compute expression with retry', 'calc_retry');
  const result = await orchestrator.executeWorkflow(builder.build(), ctx);

  console.log(`\n${bold}${green}✔ Recovered and Finished via Exponential Backoff!${reset}`);
  console.log(`  Total Attempts: ${ctx.attemptsPerStep.step_calc}`);
  console.log(`  Final State: ${result.finalState}`);
}

async function runScenario4_SagaRollbackCompensation() {
  banner('SCENARIO 4: Saga Rollback Compensation\nStep 1 executes calculation, Step 2 encounters fatal error -> Compensation executes undo');

  const executor = new MockToolExecutor();
  let rollbackExecuted = false;

  executor.configureMock('comp_revert', {
    mockHandler: (p) => {
      rollbackExecuted = true;
      console.log(`  ${red}${bold}↺ SAGA COMPENSATION EXECUTED:${reset} Reverted state: ${JSON.stringify(p)}`);
      return { reverted: true };
    },
  });

  executor.configureMock('summarize_text', {
    failNTimes: 10,
    failureErrorMessage: 'Simulated critical text synthesis crash',
  });

  const builder = new WorkflowBuilder('wf_demo_saga', 'Saga Demo')
    .addToolStep('step_calc_1', 'Compute Initial Metric', 'calculator', {
      expression: '42 * 10',
    }, {
      riskLevel: RiskLevel.A_INFORMATIONAL,
      compensationAction: {
        id: 'comp_cleanup',
        description: 'Revert metric state on failure',
        toolName: 'comp_revert',
        parameters: { metric: 'initial_score' },
        runOnFailureOnly: true,
      },
    })
    .addToolStep('step_crash', 'Failing Processing Step', 'summarize_text', {
      text: 'content',
    })
    .addSequentialTransitions();

  const orchestrator = new WorkflowOrchestrator(executor);
  const ctx = createContext('wf_demo_saga', 'Process calculation with compensation', 'saga_test');
  const result = await orchestrator.executeWorkflow(builder.build(), ctx);

  console.log(`\n${bold}${yellow}Workflow Handled Downstream Failure Graciously:${reset}`);
  console.log(`  Final State: ${bold}${result.finalState}${reset}`);
  console.log(`  Compensation Triggered: ${bold}${rollbackExecuted ? green + 'YES (Reverted)' : red + 'NO'}${reset}`);
}

async function main() {
  console.log(`${bold}${magenta}========================================================================${reset}`);
  console.log(`${bold}${cyan}  Agentic Workflow System Demo — Real Specification Edition${reset}`);
  console.log(`${bold}${magenta}========================================================================${reset}`);

  try {
    await runScenario1_CalcSummarize();
    await runScenario2_SafetyGateApproval();
    await runScenario3_TransientFailureAndExponentialBackoff();
    await runScenario4_SagaRollbackCompensation();

    console.log('\n' + '='.repeat(70));
    console.log(`${bold}${green}All 4 Live Demo Scenarios Completed with 100% Fidelity!${reset}`);
    console.log('='.repeat(70) + '\n');
  } catch (err) {
    console.error('Demo encountered error:', err);
    process.exit(1);
  }
}

void main();
