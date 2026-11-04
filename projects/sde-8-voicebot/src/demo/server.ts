/**
 * Interactive Web Dashboard Server for Live Evaluation and Team Demos
 * Exposes SSE streaming and REST API for orchestrating workflows
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowOrchestrator } from '../scheduler/WorkflowOrchestrator.js';
import { MockToolExecutor } from '../tools/MockToolExecutor.js';
import { SafetyGate } from '../safety/SafetyGate.js';
import {
  createPdfSummarizeWorkflow,
  createControlledFileCleanupWorkflow,
  createCodeErrorDiagnosisWorkflow,
} from '../workflows/predefined-workflows.js';
import { WorkflowBuilder } from '../workflows/WorkflowBuilder.js';
import { RiskLevel } from '../types/safety.js';
import { WorkflowContext } from '../types/workflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const sseClients: http.ServerResponse[] = [];

const toolExecutor = new MockToolExecutor();
const safetyGate = new SafetyGate();
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

async function runWorkflowById(workflowType: string) {
  activeOrchestrator = new WorkflowOrchestrator(toolExecutor, safetyGate);

  activeOrchestrator.on('stateTransition', (data) => {
    broadcastSSE('transition', data);
  });

  activeOrchestrator.on('stepStarted', (data) => {
    broadcastSSE('stepStarted', data);
  });

  activeOrchestrator.on('stepFinished', (data) => {
    broadcastSSE('stepFinished', data);
  });

  activeOrchestrator.on('approvalRequested', (data) => {
    broadcastSSE('approvalRequested', data);
  });

  activeOrchestrator.getRecoveryEngine().on('retryAttempt', (data) => {
    broadcastSSE('retryAttempt', data);
  });

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

  // API: Get Info / Available Tools
  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        tools: toolExecutor.listTools(),
        policy: safetyGate.getPolicy(),
        currentState: activeOrchestrator?.getStateMachine().getState() || 'IDLE',
      })
    );
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
  console.log(`========================================================================\n`);
});
