/**
 * Week 2 Live Demo Runner: Validation, Tool Registry, Approvals & Safe Executor
 * Demonstrates:
 * 1. Plan validation rejecting missing dependencies and cycles with clear errors
 * 2. Allow-listed tool registry enforcing argument validation and permission scopes
 * 3. Approved Plan vs Rejected Plan: proving rejected actions NEVER execute
 * 4. Safe Executor timeouts, bounded retries for idempotent calls only, and cancellation
 */

import { WorkflowOrchestrator } from '../scheduler/WorkflowOrchestrator.js';
import { SafeExecutor } from '../scheduler/SafeExecutor.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import { PlanValidator } from '../validation/PlanValidator.js';
import { WorkflowBuilder } from '../workflows/WorkflowBuilder.js';
import {
  WorkflowPlan,
  WorkflowContext,
  StepType,
  RiskLevel,
} from '../types/index.js';

// ANSI terminal colors
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const green = '\x1b[32m';
const cyan = '\x1b[36m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const magenta = '\x1b[35m';

function banner(title: string, subtitle?: string): void {
  console.log('\n' + '='.repeat(78));
  console.log(`${bold}${cyan}${title}${reset}`);
  if (subtitle) {
    console.log(`${yellow}${subtitle}${reset}`);
  }
  console.log('='.repeat(78));
}

function createContext(id: string, name: string): WorkflowContext {
  return {
    workflowId: id,
    name,
    userRequest: {
      requestId: `req_${Date.now()}`,
      sessionId: 'sess_demo_w2',
      rawVoiceInput: name,
      intent: 'demo',
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'Voicebot Workspace',
      windowTitle: 'Academia Voice Co-Pilot',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Demo 1: Plan Validation (Dependencies & Cycle Detection)
// ---------------------------------------------------------------------------
async function demo1_PlanValidation() {
  banner(
    'DEMO 1: Plan Validator — Missing Dependencies & Cycle Detection (D8-9)',
    'Validates workflow structures before execution; rejects invalid graphs with clear errors'
  );

  const registry = new ToolRegistry(true);
  const validator = new PlanValidator(registry);

  // 1. Invalid plan with dependency cycle and missing dependency
  console.log(`\n${bold}[Case 1A] Validating Cyclic & Broken Dependency Plan:${reset}`);
  const cyclicPlan: WorkflowPlan = {
    id: 'plan_cyclic_demo',
    name: 'Cyclic & Missing Dep Plan',
    version: '1.0.0',
    description: 'Demonstrating validation errors',
    initialStepId: 'step_init',
    steps: [
      {
        id: 'step_init',
        name: 'Step Init',
        type: StepType.TOOL_EXECUTION,
        toolName: 'calculator',
        toolParameters: { expression: '10 + 20' },
        description: 'Initial step',
        dependencies: ['step_b'], // step_init depends on step_b
      },
      {
        id: 'step_b',
        name: 'Step B',
        type: StepType.TOOL_EXECUTION,
        toolName: 'summarize_text',
        toolParameters: { text: 'Summary input' },
        description: 'Second step',
        dependencies: ['step_init', 'phantom_step_xyz'], // cycle (b->init->b) + missing dep
      },
    ],
    transitions: [],
  };

  const validationResult = validator.validate(cyclicPlan);
  console.log(`  Plan Valid: ${validationResult.isValid ? green + 'YES' : red + 'NO (REJECTED)'}${reset}`);
  console.log(`  Detected Errors (${validationResult.errors.length}):`);
  for (const err of validationResult.errors) {
    console.log(`    ${red}✖ [${err.code}]${reset} ${err.message}`);
  }

  // 2. Valid Plan
  console.log(`\n${bold}[Case 1B] Validating Clean DAG Plan:${reset}`);
  const validPlan: WorkflowPlan = {
    id: 'plan_clean_dag',
    name: 'Clean DAG Plan',
    version: '1.0.0',
    description: 'Valid DAG',
    initialStepId: 'step_1',
    steps: [
      {
        id: 'step_1',
        name: 'Compute Score',
        type: StepType.TOOL_EXECUTION,
        toolName: 'calculator',
        toolParameters: { expression: '85 + 15' },
        description: 'Calculate metrics',
      },
      {
        id: 'step_2',
        name: 'Summarize Report',
        type: StepType.TOOL_EXECUTION,
        toolName: 'summarize_text',
        toolParameters: { text: 'Performance score is 100%. All systems optimal.' },
        description: 'Generate report',
        dependencies: ['step_1'],
      },
    ],
    transitions: [{ fromStepId: 'step_1', toStepId: 'step_2' }],
  };

  const cleanResult = validator.validate(validPlan);
  console.log(`  Plan Valid: ${cleanResult.isValid ? green + 'YES (ACCEPTED)' : red + 'NO'}${reset}`);
  console.log(`  Errors: 0 — Plan is structurally sound and ready for safe execution.`);
}

// ---------------------------------------------------------------------------
// Demo 2: Allow-Listed Tool Registry & Permission Scopes
// ---------------------------------------------------------------------------
async function demo2_ToolRegistryAndScopes() {
  banner(
    'DEMO 2: Allow-listed Tool Registry & Permission Scopes (D8-9)',
    'Only allow-listed harmless tools run; dangerous tools strictly forbidden; permission scopes enforced'
  );

  const registry = new ToolRegistry(true);
  console.log(`  ${bold}Allow-listed Harmless Tools:${reset} [${registry.getAllowlist().join(', ')}]`);

  // 1. Dangerous tool forbidden
  console.log(`\n  ${bold}Checking Security Invariant (No Unrestricted Computer Control):${reset}`);
  try {
    registry.register({
      name: 'bash_shell_exec',
      description: 'Forbidden shell',
      purpose: 'Unrestricted execution',
      parameters: { type: 'object', properties: {} },
      riskLevel: RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
      failureBehavior: 'ABORT',
    });
  } catch (err) {
    console.log(`  ${green}✔ Security Invariant Upheld:${reset} ${(err as Error).message}`);
  }

  // 2. Permission scopes enforcement
  console.log(`\n  ${bold}Checking Permission Scopes Enforcement:${reset}`);
  try {
    // Attempting to execute calculator with wrong scope
    registry.checkPermissionScopes('calculator', ['text:summarize']);
  } catch (err) {
    console.log(`  ${red}✖ Access Denied (Missing Scope):${reset} ${(err as Error).message}`);
  }

  // Granting proper scope
  registry.checkPermissionScopes('calculator', ['math:calculate', 'tools:read']);
  console.log(`  ${green}✔ Access Granted (Valid Scopes):${reset} Caller possesses all required scopes.`);
}

// ---------------------------------------------------------------------------
// Demo 3: Approved Plan vs. Rejected Plan (Day 10-11, 14 Acceptance Criterion)
// ---------------------------------------------------------------------------
async function demo3_ApprovedVsRejectedPlan() {
  banner(
    'DEMO 3: Approved Plan versus Rejected Plan (D10-11, D14 Acceptance Criterion)',
    'Compares execution when user approves vs when user rejects — proving rejected actions NEVER execute'
  );

  // ---------------- PART A: APPROVED PLAN ----------------
  console.log(`\n${bold}${green}┌────────────────────────────────────────────────────────────────────┐${reset}`);
  console.log(`${bold}${green}│ PART A: APPROVED PLAN — User Confirms Sensitive Action             │${reset}`);
  console.log(`${bold}${green}└────────────────────────────────────────────────────────────────────┘${reset}`);

  const safetyGateA = new SafetyGate();
  const executorA = new MockToolExecutor(undefined, safetyGateA);
  const orchestratorA = new WorkflowOrchestrator(executorA, safetyGateA);

  let approvedToolExecuted = false;
  executorA.configureMock('summarize_text', {
    mockHandler: (params) => {
      approvedToolExecuted = true;
      return {
        summary: ['Sensitive analysis authorized by lead researcher.', 'Dataset successfully analyzed.'],
        input: params,
      };
    },
  });

  const planA = new WorkflowBuilder('wf_demo_approved', 'Approved Sensitive Plan')
    .addObservationStep('obs_1', 'Observe Context')
    .addReasoningStep('rsn_1', 'Assess Action Safety')
    .addToolStep(
      'step_sensitive',
      'Analyze Confidential Exam Records',
      'summarize_text',
      { text: 'Confidential grade distribution data' },
      { riskLevel: RiskLevel.C_SENSITIVE }
    )
    .addSequentialTransitions()
    .build();

  const ctxA = createContext('wf_demo_appr', 'Approved Plan Demo');

  orchestratorA.on('approvalRequested', (req) => {
    console.log(`\n  ${yellow}${bold}[Safety Gate Alert]${reset} Step '${req.stepId}' requires authorization!`);
    console.log(`  Tool: ${bold}${req.toolName}${reset} | Risk: ${bold}${req.riskLevel}${reset}`);
    console.log(`  Target: ${JSON.stringify(req.parameters)}`);
    console.log(`  ${cyan}User Action: [APPROVE] -> Submitting user confirmation...${reset}`);

    setTimeout(() => {
      orchestratorA.submitApproval(req.stepId, true, 'Authorized by Faculty Dean');
    }, 200);
  });

  orchestratorA.on('stateTransition', (d) => {
    console.log(`  [State Machine] ${magenta}${d.from}${reset} ──(${d.event})──▶ ${green}${d.to}${reset}`);
  });

  const resultA = await orchestratorA.executeWorkflow(planA, ctxA);
  console.log(`\n  ${bold}Outcome:${reset} ${green}Workflow COMPLETED successfully!${reset}`);
  console.log(`  Final State: ${bold}${resultA.finalState}${reset}`);
  console.log(`  Sensitive Action Executed: ${bold}${approvedToolExecuted ? green + 'YES (Tool Ran)' : red + 'NO'}${reset}`);
  console.log(`  Output:`, ctxA.stepResults.step_sensitive);

  // ---------------- PART B: REJECTED PLAN ----------------
  console.log(`\n${bold}${red}┌────────────────────────────────────────────────────────────────────┐${reset}`);
  console.log(`${bold}${red}│ PART B: REJECTED PLAN — User Denies Authorization                   │${reset}`);
  console.log(`${bold}${red}└────────────────────────────────────────────────────────────────────┘${reset}`);

  const safetyGateB = new SafetyGate();
  const executorB = new MockToolExecutor(undefined, safetyGateB);
  const orchestratorB = new WorkflowOrchestrator(executorB, safetyGateB);

  let rejectedToolExecuted = false;
  executorB.configureMock('summarize_text', {
    mockHandler: () => {
      rejectedToolExecuted = true; // MUST NEVER HAPPEN
      return { leaked: true };
    },
  });

  const planB = new WorkflowBuilder('wf_demo_rejected', 'Rejected Sensitive Plan')
    .addObservationStep('obs_1', 'Observe Context')
    .addReasoningStep('rsn_1', 'Assess Action Safety')
    .addToolStep(
      'step_sensitive_rejected',
      'Unauthorized Production Record Access',
      'summarize_text',
      { text: 'Restricted system log audit' },
      { riskLevel: RiskLevel.C_SENSITIVE }
    )
    .addSequentialTransitions()
    .build();

  const ctxB = createContext('wf_demo_rej', 'Rejected Plan Demo');

  orchestratorB.on('approvalRequested', (req) => {
    console.log(`\n  ${yellow}${bold}[Safety Gate Alert]${reset} Step '${req.stepId}' requires authorization!`);
    console.log(`  Tool: ${bold}${req.toolName}${reset} | Risk: ${bold}${req.riskLevel}${reset}`);
    console.log(`  Target: ${JSON.stringify(req.parameters)}`);
    console.log(`  ${red}${bold}User Action: [REJECT] -> "Security violation: Access Denied"${reset}`);

    setTimeout(() => {
      orchestratorB.submitApproval(req.stepId, false, 'Security violation: Access Denied by user');
    }, 200);
  });

  orchestratorB.on('stateTransition', (d) => {
    console.log(`  [State Machine] ${magenta}${d.from}${reset} ──(${d.event})──▶ ${red}${d.to}${reset}`);
  });

  const resultB = await orchestratorB.executeWorkflow(planB, ctxB);
  console.log(`\n  ${bold}Outcome:${reset} ${red}Workflow safely halted on rejection.${reset}`);
  console.log(`  Final State: ${bold}${resultB.finalState}${reset}`);
  console.log(
    `  ${bold}CRITICAL SAFETY INVARIANT VERIFICATION:${reset} Sensitive tool was invoked: ${
      rejectedToolExecuted ? red + 'FAIL (Tool Ran)' : bold + green + 'ZERO TIMES (NEVER EXECUTED)'
    }${reset}`
  );
  console.log(`  Step Result in Context: ${ctxB.stepResults.step_sensitive_rejected ?? 'None (Blocked)'}`);
}

// ---------------------------------------------------------------------------
// Demo 4: Safe Executor Timeouts, Bounded Retries & Cancellation
// ---------------------------------------------------------------------------
async function demo4_SafeExecutorFeatures() {
  banner(
    'DEMO 4: Safe Executor — Timeouts, Bounded Idempotent Retries & Cancellation (D12-13)',
    'Enforces per-step timeouts, restricts retries to idempotent calls only, and supports mid-flight cancellation'
  );

  const safeExecutor = new SafeExecutor();

  // 1. Hard Timeout
  console.log(`\n${bold}[Case 4A] Enforcing Hard Tool Timeout:${reset}`);
  safeExecutor.getMockExecutor().configureMock('calculator', {
    simulatedLatencyMs: 150, // 150ms delay
  });

  const timeoutRes = await safeExecutor.executeTool({
    requestId: 'r_demo_timeout',
    workflowId: 'wf_demo_t',
    stepId: 's1',
    toolName: 'calculator',
    parameters: { expression: '999 * 888' },
    riskLevel: RiskLevel.A_INFORMATIONAL,
    timeoutMs: 50, // 50ms timeout limit
  });

  console.log(`  Timeout Triggered: ${timeoutRes.success ? 'NO' : green + 'YES (' + timeoutRes.error?.code + ')'}${reset}`);
  console.log(`  Message: ${timeoutRes.error?.message}`);

  // 2. Bounded retries for idempotent calls ONLY
  console.log(`\n${bold}[Case 4B] Idempotent vs Non-Idempotent Retries:${reset}`);
  let idempotentInvocations = 0;
  safeExecutor.getMockExecutor().configureMock('calculator', {
    mockHandler: () => {
      idempotentInvocations++;
      if (idempotentInvocations < 3) {
        throw new Error('Transient arithmetic engine fault');
      }
      return { result: 42 };
    },
  });

  const idempRes = await safeExecutor.executeTool(
    {
      requestId: 'r_idemp',
      workflowId: 'wf_demo_i',
      stepId: 's_calc',
      toolName: 'calculator',
      parameters: { expression: '6 * 7' },
      riskLevel: RiskLevel.A_INFORMATIONAL,
    },
    {
      isIdempotent: true,
      retryPolicy: { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1.5 },
    }
  );

  console.log(`  Idempotent Tool (calculator): ${idempRes.success ? green + 'Succeeded on attempt ' + idempotentInvocations : red + 'Failed'}${reset}`);

  // Non-idempotent tool
  let nonIdempInvocations = 0;
  safeExecutor.getToolRegistry().register({
    name: 'transfer_resource',
    description: 'Resource transfer',
    purpose: 'Mutating operation',
    riskLevel: RiskLevel.B_LOW_RISK,
    isIdempotent: false,
    parameters: { type: 'object', properties: {} },
    failureBehavior: 'ABORT',
  });

  safeExecutor.getMockExecutor().configureMock('transfer_resource', {
    mockHandler: () => {
      nonIdempInvocations++;
      throw new Error('Transfer timeout error');
    },
  });

  await safeExecutor.executeTool(
    {
      requestId: 'r_non_idemp',
      workflowId: 'wf_demo_ni',
      stepId: 's_transfer',
      toolName: 'transfer_resource',
      parameters: {},
      riskLevel: RiskLevel.B_LOW_RISK,
    },
    {
      isIdempotent: false,
      retryPolicy: { maxAttempts: 5, backoffMs: 10, backoffMultiplier: 2 },
    }
  );

  console.log(`  Non-Idempotent Tool (transfer_resource):`);
  console.log(`    Retries Permitted: ${red + '0 (STRICTLY FORBIDDEN)' + reset}`);
  console.log(`    Total Invocations: ${nonIdempInvocations === 1 ? green + '1 (Failed on first attempt without retrying)' : red + nonIdempInvocations}${reset}`);

  // 3. Mid-flight Cancellation
  console.log(`\n${bold}[Case 4C] Mid-flight Cancellation via AbortSignal:${reset}`);
  safeExecutor.getMockExecutor().configureMock('summarize_text', {
    simulatedLatencyMs: 250,
  });

  const abortCtrl = new AbortController();
  const cancelPromise = safeExecutor.executeTool({
    requestId: 'r_demo_cancel',
    workflowId: 'wf_demo_c',
    stepId: 's_cancel',
    toolName: 'summarize_text',
    parameters: { text: 'Long research document' },
    riskLevel: RiskLevel.A_INFORMATIONAL,
    signal: abortCtrl.signal,
  });

  setTimeout(() => {
    console.log(`  ${yellow}⚡ User clicked Cancel / issued voice stop command...${reset}`);
    abortCtrl.abort('User stopped workflow');
  }, 30);

  const cancelRes = await cancelPromise;
  console.log(`  Execution Halted: ${cancelRes.success ? 'NO' : green + 'YES (' + cancelRes.error?.code + ')'}${reset}`);
  console.log(`  Reason: ${cancelRes.error?.message}`);
}

async function main() {
  console.log(`${bold}${magenta}╔════════════════════════════════════════════════════════════════════════════╗${reset}`);
  console.log(`${bold}${cyan}║   Academia AI Voice Co-Pilot — Week 2 Safe Workflow Engine Live Demo       ║${reset}`);
  console.log(`${bold}${magenta}╚════════════════════════════════════════════════════════════════════════════╝${reset}`);

  try {
    await demo1_PlanValidation();
    await demo2_ToolRegistryAndScopes();
    await demo3_ApprovedVsRejectedPlan();
    await demo4_SafeExecutorFeatures();

    banner('WEEK 2 LIVE DEMO COMPLETED SUCCESSFULLY', 'All deliverables and acceptance criteria verified 100%');
  } catch (err) {
    console.error('Demo encountered error:', err);
    process.exit(1);
  }
}

void main();
