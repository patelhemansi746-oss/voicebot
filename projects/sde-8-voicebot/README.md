# AI Voice Co-Pilot — Agentic Workflow Engine

> **Agentic Workflow Architecture Deliverable (Week 1, Week 2 & Week 3)**  
> Checkpoint & Resume, Failed-Step Recovery, Idempotency Keys, Step-Level Audit Trail with SHA-256 Hash Chaining, Progress Events, Reasoning Proposals, Backend Approval State & Safe Executor.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/Tests-108%20passed-brightgreen.svg)](https://vitest.dev/)
[![Coverage](https://img.shields.io/badge/Coverage-89.88%25-success.svg)](https://github.com/)
[![Target Branch](https://img.shields.io/badge/Branch-team%2Fsde--8--voicebot-orange.svg)](https://github.com/)

---

## 📖 Overview

The **Agentic Workflow Engine** orchestrates multi-step contextual reasoning, validation, observable execution, and safe tool invocations for the Academia AI Voice Co-Pilot.

### Key Capabilities Implemented across Milestones (Week 1 – Week 3):

1. **Checkpoint & Resume with Failed-Step Recovery (`CheckpointManager`)**:
   - Snapshot serialization of execution context, variables, completed step results, and state machine state.
   - Resuming from a checkpoint continues execution from the remaining steps.
   - **Critical Safety Invariant**: **Completed steps are NEVER re-executed** on recovery (0 duplicate tool invocations).
   - Failed-step recovery captures failure snapshots, enabling resumption from the failed step upon error resolution.

2. **Idempotency Keys (`IdempotencyManager`)**:
   - Computes deterministic SHA-256 parameter hashes.
   - Distinct parameter values yield distinct keys; re-ordered keys yield identical keys.
   - Re-invoking an operation with an identical idempotency key returns cached outputs instantly with **0 duplicate tool executions**.

3. **Step-Level Cryptographic Audit Trail (`AuditTrail`)**:
   - Append-only, immutable audit trail recording every workflow lifecycle event (`WORKFLOW_STARTED`, `STEP_STARTED`, `STEP_COMPLETED`, `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `CHECKPOINT_SAVED`, `WORKFLOW_RESUMED`, etc.).
   - Cryptographic **SHA-256 hash chaining** (`previousHash -> hash`) guarantees complete tamper detection via `verifyIntegrity()`.
   - Exportable to structured JSON.

4. **Progress Events Emitter**:
   - Monotonic 0% to 100% progress events emitted at workflow boundaries and step completions.
   - Captures status (`running`, `completed`, `paused`, `failed`, `resumed`), percentage, step ID, and step descriptions.

5. **Reasoning Proposals (`ProposalManager`)**:
   - Ingests `WorkflowProposal` objects from upstream voice/transcription/reasoning pipelines.
   - Validates proposals through `PlanValidator` before initiating execution.
   - Translates proposals into validated execution contexts.

6. **Backend Approval State & Defense**:
   - Exposes queryable backend approval states (`getApprovalState(approvalId)`) with TTL remaining countdowns and status inspection.
   - **Duplicate Approval Defense**: Calling approve/reject multiple times is safely handled and never triggers extra executions.
   - **Expired Approval Defense**: Expired approvals trigger `ApprovalExpiredError` and **NEVER execute tools (0 invocations)**.

7. **Plan Validation & Cycle Detection (`PlanValidator`)**:
   - Dependency validation and 3-color DFS cycle detection ($A \to B \to A$, multi-step cycles, and self-loops).
   - Strict allow-list enforcement (`calculator`, `summarize_text`). Dangerous tools (`bash`, `shell`, `exec`, `send_email`) are forbidden.

8. **Safe Executor (`SafeExecutor`, `MockToolExecutor`)**:
   - Per-step timeouts, bounded exponential backoff retries for idempotent calls only (0 retries for non-idempotent operations), and `AbortController` cancellation.

---

## ⚡ Quick Start

### 1. Installation
```bash
npm install
```

### 2. Run Tests & Coverage
```bash
# Run all 11 test suites (108 tests passing)
npm test

# Run test coverage check (>80% required across all modules)
npm run test:coverage

# Build TypeScript to dist/
npm run build
```

### 3. Run Live Demos
```bash
# 1. Week 3 Demo: Checkpoint & Resume, Idempotency, Audit Trail & Backend Approvals
npm run demo:week3

# 2. Week 2 Policy Demo: Validation, Approved vs Rejected Plan, Safe Executor
npm run demo:week2

# 3. Week 1 State Machine & Saga Rollback Demo
npm run demo

# 4. Interactive Web Visualizer Dashboard (HTTP + SSE)
npm run demo:ui
```

---

## 📁 Repository Structure

```text
├── src/
│   ├── audit/                  # Step-level Audit Trail with SHA-256 Hash Chaining
│   │   ├── AuditTrail.ts
│   │   └── index.ts
│   ├── checkpoint/             # Checkpoint Persistence & Resume Engine
│   │   ├── CheckpointManager.ts
│   │   └── index.ts
│   ├── reasoning/              # Reasoning Proposal Ingestion & Evaluation
│   │   ├── ProposalManager.ts
│   │   └── index.ts
│   ├── recovery/               # Error Recovery & Saga Rollback Compensations
│   │   └── ErrorRecoveryEngine.ts
│   ├── safety/                 # Approval Gate, Idempotency & Permission Policies
│   │   ├── ApprovalManager.ts
│   │   ├── IdempotencyManager.ts
│   │   └── SafetyGate.ts
│   ├── scheduler/              # SafeExecutor & WorkflowOrchestrator
│   │   ├── SafeExecutor.ts
│   │   └── WorkflowOrchestrator.ts
│   ├── state-machine/          # Deterministic 14-State FSM
│   │   ├── StateMachine.ts
│   │   └── TransitionTable.ts
│   ├── tools/                  # Allow-listed Harmless Mock Tool Registry
│   │   ├── MockToolExecutor.ts
│   │   └── ToolRegistry.ts
│   ├── types/                  # Core Schemas (WorkflowPlan, ToolSpec, Checkpoint, etc.)
│   ├── validation/             # PlanValidator (3-Color DFS Cycle Detection)
│   └── demo/                   # CLI, Web Visualizer & Live Demonstration Scripts
├── tests/                      # 11 Test Suites (108 Tests, 100% Passing)
│   ├── audit-progress.test.ts
│   ├── checkpoint-resume.test.ts
│   ├── reasoning-approvals.test.ts
│   ├── integration-w4.test.ts
│   ├── policy.test.ts
│   └── ...
└── projects/sde-8-voicebot/    # Monorepo Mirror for Course Grading Path
```

---

## 🔒 Security & Policy Invariants

- **Harmless Tools Only**: Default mock mode. Only `calculator` and `summarize_text` allowed.
- **No Unrestricted Computer Control**: `exec`, `bash`, `shell`, `terminal`, `powershell`, `mouse`, `keyboard` forbidden.
- **No External Sending**: `send_email`, `smtp`, `http_post_external` forbidden.
- **Zero Secrets / PII**: No `.env`, API keys, recordings, or user identifiers in repository history.
- **Never Push Directly to Main**: Work committed on feature branch off `team/sde-8-voicebot` and submitted via PR targeting `team/sde-8-voicebot`.
