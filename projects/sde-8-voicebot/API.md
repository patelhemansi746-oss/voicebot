# API Specifications & Interface Contracts

**Product:** AI Voice Co-Pilot  
**Component:** Agentic Workflow, Validation, Tool Registry, Approvals & Safe Executor  
**Document Version:** 2.0 (Week 2 Milestone)  

---

## 1. REST API Contracts

### 1.1 Execute Tool Action
Requests safe execution of an allow-listed tool with parameters, scopes, and approval verification.

- **Endpoint:** `POST /api/v1/tools/execute`
- **Headers:** `Content-Type: application/json`

#### Request Payload
```json
{
  "workflow_id": "wf_calc_summarize",
  "step_id": "step_calc",
  "tool_name": "calculator",
  "parameters": {
    "expression": "(25 * 4) + 150"
  },
  "risk_level": "A_INFORMATIONAL",
  "granted_scopes": ["math:calculate", "tools:read"],
  "timeout_ms": 5000
}
```

#### Successful Response (`200 OK`)
```json
{
  "request_id": "req_17932840001",
  "tool_name": "calculator",
  "success": true,
  "data": {
    "expression": "(25 * 4) + 150",
    "result": 250
  },
  "duration_ms": 12,
  "timestamp": 17932840001
}
```

#### Blocked on Rejection / Expiration Response (`403 Forbidden`)
```json
{
  "error": {
    "code": "ACTION_APPROVAL_BLOCKED",
    "message": "Action was REJECTED (User denied). Rejected actions never execute.",
    "request_id": "req_17932840002"
  }
}
```

---

### 1.2 Submit Human Approval Decision
Submits a user decision for an action paused in `AWAITING_APPROVAL`.

- **Endpoint:** `POST /api/v1/approvals`
- **Headers:** `Content-Type: application/json`

#### Request Payload
```json
{
  "approval_id": "appr_wf_action_step_action_17932840000",
  "workflow_id": "wf_controlled_action",
  "step_id": "step_action",
  "approved": true,
  "decided_by": "USER",
  "reason": "Authorized by user"
}
```

#### Response (`200 OK`)
```json
{
  "status": "decision_recorded",
  "approval_id": "appr_wf_action_step_action_17932840000",
  "workflow_id": "wf_controlled_action",
  "resumed_state": "EXECUTING_TOOL"
}
```

---

## 2. TypeScript Programmatic API

### 2.1 Core Schemas
```typescript
import type {
  WorkflowPlan,
  WorkflowStep,
  WorkflowResult,
  ToolSpec,
  RiskLevel,
} from 'voicebot-agentic-workflow';
```

---

### 2.2 `PlanValidator` (Week 2 Milestone D8–9)
Validates workflow plans for dependency integrity, cycle detection, and allow-listed tools.

```typescript
import { PlanValidator, ToolRegistry } from 'voicebot-agentic-workflow';

const registry = new ToolRegistry(true);
const validator = new PlanValidator(registry);

// Validate and inspect errors
const result = validator.validate(workflowPlan, {
  checkToolRegistry: true,
  detectTransitionCycles: true,
});

if (!result.isValid) {
  for (const err of result.errors) {
    console.error(`[${err.code}] ${err.message}`);
    // e.g. [DEPENDENCY_CYCLE_DETECTED] Dependency cycle detected: step_a -> step_b -> step_a
  }
}

// Or throw PlanValidationError immediately
validator.validateOrThrow(workflowPlan);
```

---

### 2.3 `ToolRegistry` (Week 2 Milestone D8–9)
Manages allow-lists, validates schemas, and enforces permission scopes.

```typescript
import { ToolRegistry } from 'voicebot-agentic-workflow';

const registry = new ToolRegistry(true); // Loads harmless built-ins: 'calculator', 'summarize_text'

// Allow-list checks
registry.isAllowlisted('calculator'); // true
registry.isAllowlisted('unlisted_tool'); // false
registry.assertAllowlisted('calculator'); // OK

// Permission scope checks
registry.checkPermissionScopes('calculator', ['math:calculate', 'tools:read']); // true
registry.checkPermissionScopes('calculator', ['*']); // true (wildcard)

// Schema argument validation
registry.validateParameters('calculator', { expression: '10 + 20' }); // OK
```

---

### 2.4 `ApprovalManager` & `SafetyGate` (Week 2 Milestone D10–11)
Manages human-in-the-loop approvals with TTL, rejection, and strict non-execution invariants.

```typescript
import { ApprovalManager, SafetyGate, RiskLevel } from 'voicebot-agentic-workflow';

const gate = new SafetyGate();
const manager = gate.getApprovalManager();

// 1. Create approval request with TTL
const req = manager.createRequest({
  workflowId: 'wf_1',
  stepId: 'step_auth',
  toolName: 'summarize_text',
  riskLevel: RiskLevel.C_SENSITIVE,
  parameters: { text: 'Classified records' },
  ttlMs: 60000, // 60 seconds TTL
});

// 2. Approve
manager.approve(req.approvalId, { reason: 'Lead investigator authorized' });

// 3. Or Reject
manager.reject(req.approvalId, 'Security breach suspected');

// 4. Assert executable invariant: throws if REJECTED, EXPIRED, or PENDING
manager.assertCanExecute(req.approvalId);
```

---

### 2.5 `SafeExecutor` (Week 2 Milestone D12–13)
Safe executor with per-tool timeouts, bounded retries for idempotent calls only, and cancellation.

```typescript
import { SafeExecutor, RiskLevel } from 'voicebot-agentic-workflow';

const safeExecutor = new SafeExecutor();

// Execute a tool safely
const result = await safeExecutor.executeTool(
  {
    requestId: 'req_safe_1',
    workflowId: 'wf_1',
    stepId: 'step_calc',
    toolName: 'calculator',
    parameters: { expression: '42 * 10' },
    riskLevel: RiskLevel.A_INFORMATIONAL,
    timeoutMs: 5000,
    grantedScopes: ['math:calculate', 'tools:read'],
  },
  {
    isIdempotent: true, // Idempotent calls can be safely retried
    retryPolicy: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2 },
  }
);

// Cancellation
safeExecutor.cancel('req_safe_1', 'Cancelled by voice command');

// Execute full plan safely with automatic plan validation
const planResult = await safeExecutor.executePlan(workflowPlan, context);
```

---

### 2.6 `WorkflowOrchestrator`
Coordinates multi-step workflow execution across state machine, safety gates, and tools.

```typescript
import { WorkflowOrchestrator, MockToolExecutor } from 'voicebot-agentic-workflow';

const executor = new MockToolExecutor();
const orchestrator = new WorkflowOrchestrator(executor);

// Handle human approval requests
orchestrator.on('approvalRequested', (req) => {
  orchestrator.submitApproval(req.stepId, true);
});

// Cancel in-flight workflow
await orchestrator.cancel('User stopped workflow');

// Execute complete workflow
const result = await orchestrator.executeWorkflow(workflowPlan, context, {
  validatePlan: true,
});
```
