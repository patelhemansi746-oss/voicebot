/**
 * Interactive Web Dashboard Server for Live Evaluation and Team Demos
 * Exposes SSE streaming and REST API for orchestrating workflows,
 * querying audit trails, reading backend approval states, and resuming checkpoints.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowOrchestrator } from '../scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import { CheckpointManager } from '../checkpoint/CheckpointManager.js';
import { IdempotencyManager } from '../safety/IdempotencyManager.js';
import { AuditTrail } from '../audit/AuditTrail.js';
import { ProposalManager } from '../reasoning/ProposalManager.js';
import {
  createPdfSummarizeWorkflow,
  createControlledFileCleanupWorkflow,
  createCodeErrorDiagnosisWorkflow,
} from '../workflows/predefined-workflows.js';
import { WorkflowBuilder } from '../workflows/WorkflowBuilder.js';
import { RiskLevel } from '../types/safety.js';
import { WorkflowContext } from '../types/workflow.js';
import { WorkflowProposal } from '../types/reasoning.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const sseClients: http.ServerResponse[] = [];

const toolExecutor = new MockToolExecutor();
const safetyGate = new SafetyGate();
const checkpointManager = new CheckpointManager();
const idempotencyManager = new IdempotencyManager();
const auditTrail = new AuditTrail();
const proposalManager = new ProposalManager();

let activeOrchestrator: WorkflowOrchestrator | null = null;
let activeContext: WorkflowContext | null = null;

function broadcastSSE(eventType: string, data: unknown) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      // client disconnected
    }
  }
}

function createRequestContext(workflowId: string, intent: string, query: string): WorkflowContext {
  return {
    workflowId,
    name: `Web Demo: ${intent}`,
    userRequest: {
      requestId: `req_${Date.now()}`,
      sessionId: 'sess_web_demo',
      rawVoiceInput: query,
      intent,
      timestamp: Date.now(),
    },
    appContext: {
      activeApplication: 'VS Code - Academia AI Co-Pilot',
      windowTitle: 'AI Voicebot System',
      visibleContent: 'PRD and System Design Document open in editor buffer',
    },
    stepResults: {},
    variables: {},
    attemptsPerStep: {},
    approvals: {},
    logs: [],
    startTime: Date.now(),
  };
}

function initOrchestrator(): WorkflowOrchestrator {
  const orch = new WorkflowOrchestrator(
    toolExecutor,
    safetyGate,
    undefined,
    undefined,
    checkpointManager,
    idempotencyManager,
    auditTrail
  );

  orch.on('stateTransition', (data) => broadcastSSE('transition', data));
  orch.on('stepStarted', (data) => broadcastSSE('stepStarted', data));
  orch.on('stepFinished', (data) => broadcastSSE('stepFinished', data));
  orch.on('approvalRequested', (data) => broadcastSSE('approvalRequested', data));
  orch.on('progress', (data) => broadcastSSE('progress', data));
  orch.on('checkpointSaved', (data) => broadcastSSE('checkpointSaved', data));
  orch.on('workflowResumed', (data) => broadcastSSE('workflowResumed', data));

  orch.getRecoveryEngine().on('retryAttempt', (data) => {
    broadcastSSE('retryAttempt', data);
  });

  auditTrail.on('auditRecord', (record) => {
    broadcastSSE('auditRecord', record);
  });

  return orch;
}

async function runWorkflowById(workflowType: string) {
  activeOrchestrator = initOrchestrator();

  let definition;
  switch (workflowType) {
    case 'pdf_summarize':
      definition = createPdfSummarizeWorkflow();
      activeContext = createRequestContext('wf_pdf_summarize', 'PDF Summary', 'Find report and summarize');
      break;

    case 'file_cleanup':
      definition = createControlledFileCleanupWorkflow();
      activeContext = createRequestContext('wf_cleanup', 'File Cleanup', 'Delete temporary cache file');
      break;

    case 'code_diag':
      definition = createCodeErrorDiagnosisWorkflow();
      activeContext = createRequestContext('wf_code_diag', 'Code Diagnostic', 'Why is this error happening?');
      break;

    case 'retry_demo':
      toolExecutor.configureMock('calculator', {
        failNTimes: 2,
        failureErrorCode: 'TRANSIENT_COMPUTE_BUSY',
        failureErrorMessage: 'Simulated 503 Service Unavailable',
      });
      definition = new WorkflowBuilder('wf_retry', 'Retry Demo')
        .addReasoningStep('step_rsn', 'Reasoning')
        .addPlanningStep('step_pln', 'Planning')
        .addToolStep('step_calc', 'Compute Metric', 'calculator', { expression: '50 * 4' }, {
          riskLevel: RiskLevel.A_INFORMATIONAL,
          retryPolicy: { maxAttempts: 3, backoffMs: 80, backoffMultiplier: 2 },
          isIdempotent: true,
        })
        .addResponseStep('step_resp', 'Formulate Response')
        .addSequentialTransitions()
        .build();
      activeContext = createRequestContext('wf_retry', 'Fault Tolerance', 'Compute expression with retry');
      break;

    default:
      throw new Error(`Unknown workflow type: ${workflowType}`);
  }

  broadcastSSE('workflowStarted', {
    workflowType,
    id: definition.id,
    name: definition.name,
    steps: definition.steps,
  });

  const result = await activeOrchestrator.executeWorkflow(definition, activeContext);
  broadcastSSE('workflowCompleted', result);
  return result;
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Stream endpoint
  if (req.url === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: connected\ndata: {"status":"connected"}\n\n');
    sseClients.push(res);

    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  // API: Run workflow
  if (req.url === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { type } = JSON.parse(body || '{}');
        void runWorkflowById(type || 'pdf_summarize');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'launched', type }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // API: Run Reasoning Proposal
  if (req.url === '/api/proposals/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const proposal: WorkflowProposal = JSON.parse(body || '{}');
        activeOrchestrator = initOrchestrator();
        broadcastSSE('proposalReceived', proposal);
        void proposalManager.executeProposal(proposal, activeOrchestrator);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'proposal_executing', proposalId: proposal.proposalId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // API: Submit Approval
  if (req.url === '/api/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { stepId, approved, reason } = JSON.parse(body || '{}');
        if (!activeOrchestrator) {
          throw new Error('No active orchestrator');
        }
        activeOrchestrator.submitApproval(stepId, Boolean(approved), reason);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'decision_recorded', stepId, approved }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // API: Get Backend Approval State
  if (req.url?.startsWith('/api/approvals') && req.method === 'GET') {
    const urlParts = req.url.split('/');
    if (urlParts.length === 4 && urlParts[3]) {
      const approvalId = urlParts[3];
      const state = safetyGate.getApprovalManager().getApprovalState(approvalId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state ?? { error: 'Not found' }));
      return;
    }
    const approvals = safetyGate.getApprovalManager().listApprovals();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(approvals));
    return;
  }

  // API: Get Audit Trail & Hash Integrity
  if (req.url === '/api/audit' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      records: auditTrail.getRecords(),
      integrity: auditTrail.verifyIntegrity(),
    }));
    return;
  }

  // API: Checkpoints List
  if (req.url === '/api/checkpoints' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checkpointManager.listCheckpoints()));
    return;
  }

  // API: Resume from Checkpoint
  if (req.url === '/api/checkpoints/resume' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { checkpointId } = JSON.parse(body || '{}');
        activeOrchestrator = initOrchestrator();
        void activeOrchestrator.resumeWorkflow(checkpointId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'resuming', checkpointId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // API: Status
  if (req.url === '/api/status' && req.method === 'GET') {
    void (async () => {
      const checkpoints = await checkpointManager.listCheckpoints();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tools: toolExecutor.listTools(),
          policy: safetyGate.getPolicy(),
          currentState: activeOrchestrator?.getStateMachine().getState() || 'IDLE',
          checkpointsCount: checkpoints.length,
          auditRecordsCount: auditTrail.getRecords().length,
        })
      );
    })();
    return;
  }

  // Serve Dashboard HTML
  if (req.url === '/' || req.url === '/index.html') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n========================================================================`);
  console.log(`🚀 Live Demo Web Visualizer running at: http://localhost:${PORT}`);
  console.log(`   Interactive State Machine, Safety Gate & Tool Execution Dashboard`);
  console.log(`   Week 3: Checkpoint & Resume, Audit Trail, Backend Approvals & Progress`);
  console.log(`========================================================================\n`);
});
