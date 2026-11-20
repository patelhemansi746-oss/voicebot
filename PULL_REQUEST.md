# Pull Request: Agentic Workflow Checkpoint & Resume, Audit Trail & Approval Integration (Week 3)

**Repository:** `https://github.com/Yashuudevang/acd_voicebot`  
**Source Branch:** `feat-week-3-checkpoint-resume`  
**Target Branch:** `team/sde-8-voicebot` (or `develop`)  
**Project Path:** `projects/sde-8-voicebot/` (root workspace)  
**Author:** Hemansi (Voicebot Engineering Team)  
**Title:** `feat(week-3): Checkpoint & Resume, Audit Trail, Idempotency & Reasoning Approval Integration`  
**Status:** Ready for Review & Grading  

---

## 📌 Executive Summary & Specification Alignment (Week 3 / W4)

This pull request completes the **Week 3 Agentic Workflow Engineering Milestones** (Days 15 through 21) for the **Academia AI Voice Co-Pilot**, making workflows fully observable, recoverable, and wired to upstream reasoning proposals, backend approval states, and UI interactions:

1. **Checkpoint and Resume (`CheckpointManager`)**:
   - **Snapshot Persistence**: Saves complete serializable execution snapshots (`context.variables`, completed step results, execution progress, state machine state) after step completions and before approval gates.
   - **CRITICAL INVARIANT — Completed Steps Are NEVER Re-executed**: On resumption, the orchestrator detects completed steps from the checkpoint and skips them deterministically. Completed tools are called **EXACTLY ZERO TIMES** during recovery.
   - **Failed-Step Recovery**: When an unexpected or transient node error occurs, a failure checkpoint is recorded. After error resolution, execution resumes from the failed step onward without re-executing preceding steps.

2. **Idempotency Keys (`IdempotencyManager`)**:
   - **Deterministic Parameter Hashing**: Computes normalized SHA-256 parameter hashes invariant to JSON key ordering.
   - **Duplicate Invocations Prevented**: When a step or tool execution is requested with an identical idempotency key, cached results are returned immediately. The underlying tool handler is called **EXACTLY ONCE**.

3. **Step-Level Cryptographic Audit Trail (`AuditTrail`)**:
   - **Observable Execution History**: Records an immutable, append-only record for every step and lifecycle event (`WORKFLOW_STARTED`, `STEP_STARTED`, `STEP_COMPLETED`, `APPROVAL_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `CHECKPOINT_SAVED`, `WORKFLOW_RESUMED`, `TOOL_INVOKED`, etc.).
   - **Cryptographic SHA-256 Hash Chaining**: Every record references `previousHash` and computes `hash` over its payload. `verifyIntegrity()` detects any unauthorized modification to sequence, timestamp, or data payload.

4. **Progress Events Emitter**:
   - Monotonic 0% to 100% progress events emitted at workflow boundaries and step completions.
   - Emits step ID, status (`running`, `completed`, `paused`, `failed`, `resumed`), percentage, and human-readable descriptions.

5. **Reasoning Proposals (`ProposalManager`)**:
   - Ingests `WorkflowProposal` generated from upstream voice recognition and LLM reasoning.
   - Pre-validates the proposed `WorkflowPlan` using `PlanValidator` (acyclicity, dependencies, allow-list) before execution begins.
   - Rejects broken or cyclic proposals with actionable error messages.

6. **Backend Approval State & Defense**:
   - Exposes queryable backend approval states (`getApprovalState(approvalId)`) with TTL remaining countdowns and status inspection.
   - **Duplicate Approval Defense**: Calling approve/reject multiple times is safely handled and never triggers extra executions.
   - **Expired Approval Defense**: Expired approvals trigger `ApprovalExpiredError` and **NEVER execute tools (0 invocations)**.

---

## 📅 Deliverables & Acceptance Criteria Matrix

| Milestone | Deliverable | Acceptance Criteria | Status | Evidence |
|:---|:---|:---|:---:|:---|
| **D15–16** | **Checkpoint & Resume** | A workflow can checkpoint and resume after a failure; recovery does not re-run completed steps; idempotency keys prevent duplicate execution | ✅ **PASS** | `CheckpointManager` snapshots state; `resumeWorkflow()` skips completed steps; `IdempotencyManager` caches tool calls; 8 tests in `tests/checkpoint-resume.test.ts`. |
| **D17–18** | **Audit Trail & Progress** | Every step writes an audit record and emits progress events | ✅ **PASS** | `AuditTrail` maintains SHA-256 hash chaining; monotonic 0–100% progress events verified in `tests/audit-progress.test.ts`. |
| **D19–20** | **Reasoning & Approvals** | WorkflowProposals from reasoning are accepted, approval state is read from backend, and UI can approve/reject | ✅ **PASS** | `ProposalManager` validates proposals; `ApprovalManager.getApprovalState()` exposes TTL & status; verified in `tests/reasoning-approvals.test.ts`. |
| **D19–20** | **Approval Invariants** | Tests prove duplicate and expired approvals never execute a tool | ✅ **PASS** | Spies verify tool mock handlers are called **0 times on expired approvals** and **exactly 1 time on duplicate approvals**. |
| **D21** | **Integration Evidence** | Day 21 team gate: complete session flows through voice, reasoning, policy, backend and UI | ✅ **PASS** | Full integration test passes in `tests/integration-w4.test.ts`; live demo runnable via `npm run demo:week3`. |
| **D21** | **Safety & Policies** | Only harmless mock tools exist; tests pass in mock mode; PR includes test output; demo given | ✅ **PASS** | 108 tests passing; **89.88% line coverage, 82.82% branch coverage**; mock mode default. |

---

## 🏗️ Architecture: Checkpoint, Resume & Audit Pipeline

```mermaid
flowchart TD
    UserVoice([User Voice Command]) --> Transcription[Transcription Engine]
    Transcription --> Reasoning[Reasoning Proposal Engine]
    Reasoning --> Proposal[WorkflowProposal Definition]
    
    subgraph ValidationStage [Phase 1: Validation & Ingestion]
        Proposal --> Validator[PlanValidator]
        Validator -->|Check Dependencies, Cycles & Allow-list| GateCheck{Valid DAG?}
        GateCheck -->|Invalid| RejectProposal[Reject Proposal with Error]
        GateCheck -->|Valid| Orchestrator[WorkflowOrchestrator]
    end
    
    subgraph ExecutionStage [Phase 2: Execution, Checkpoints & Audit]
        Orchestrator --> AuditLog[(AuditTrail: SHA-256 Hash Chain)]
        Orchestrator --> ProgressStream[Progress Events: 0% -> 100%]
        
        Orchestrator --> StepExec[Step Execution]
        StepExec --> IdemCheck{Idempotency Key Cached?}
        IdemCheck -->|Yes: Key Hit| ReturnCached[Return Cached Output (0 Tool Runs)]
        IdemCheck -->|No: First Call| ToolExecution[Execute Safe Harmless Tool]
        
        StepExec --> PostCkpt[(CheckpointManager: Save Step Snapshot)]
    end
    
    subgraph ApprovalStage [Phase 3: Backend Approval Gate]
        StepExec --> RiskCheck{Risk Level C or D?}
        RiskCheck -->|Yes| PreApprCkpt[(Save Pre-Approval Checkpoint)]
        PreApprCkpt --> ApprovalGate[ApprovalManager: PENDING with TTL]
        ApprovalGate --> WebUI[Web UI / REST API / SSE]
        
        WebUI -->|Approve| ProceedExec[Resume Tool Execution]
        WebUI -->|Reject| BlockExec[Block: 0 Invocations]
        ApprovalGate -->|TTL Elapsed| ExpireBlock[Expired: 0 Invocations]
    end
    
    subgraph RecoveryStage [Phase 4: Fault Recovery]
        StepExec -->|Step Fails| FailCkpt[(Save Failure Checkpoint)]
        FailCkpt --> Resume[Resume from Checkpoint]
        Resume -->|Skip Completed Steps| StepExec
    end
```

---

## 🧪 Acceptance Criteria Verification & Test Output

### 1. Test Summary
- **Test Files:** 11 passed (11 total)
- **Tests:** 108 passed (108 total)
- **Duration:** 2.65s

### 2. Coverage Report (v8)
```text
 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   89.88 |    82.82 |   82.73 |   89.88 |                   
 audit             |   84.37 |     90.9 |      80 |   84.37 |                   
  AuditTrail.ts    |   84.37 |     90.9 |      80 |   84.37 | ...35-141,182-192 
 checkpoint        |   88.18 |    88.46 |   72.22 |   88.18 |                   
  ...intManager.ts |   88.18 |    88.46 |   72.22 |   88.18 | ...77-178,184-185 
 reasoning         |   89.65 |    93.75 |   66.66 |   89.65 |                   
  ...salManager.ts |   89.65 |    93.75 |   66.66 |   89.65 | ...,47-48,125-126 
 recovery          |    99.4 |    85.29 |     100 |    99.4 |                   
  ...veryEngine.ts |    99.4 |    85.29 |     100 |    99.4 | 152               
 safety            |   89.14 |     85.8 |   81.63 |   89.14 |                   
  ...valManager.ts |   89.65 |       81 |   79.16 |   89.65 | ...69,472-474,489 
  ...ncyManager.ts |   86.66 |    88.23 |   77.77 |   86.66 | 54-55,113-122     
  SafetyGate.ts    |   89.44 |    95.55 |    87.5 |   89.44 | ...66-174,218-221 
 scheduler         |   87.87 |    75.08 |   77.77 |   87.87 |                   
  SafeExecutor.ts  |   79.24 |    80.48 |   58.33 |   79.24 | ...24-225,244-254 
  ...chestrator.ts |   87.91 |    72.35 |   78.12 |   87.91 | ...1323,1365-1366 
  ...wScheduler.ts |     100 |    85.71 |     100 |     100 | 94,120,140-146    
 state-machine     |   94.51 |    88.46 |   87.09 |   94.51 |                   
  StateMachine.ts  |    93.3 |    83.33 |    90.9 |    93.3 | ...01-202,231-232 
  ...itionTable.ts |   96.63 |      100 |   77.77 |   96.63 | 146-147,162-163   
 tools             |   89.39 |    83.11 |   88.37 |   89.39 |                   
  ...olExecutor.ts |   86.39 |    78.65 |      90 |   86.39 | ...87,333,393-394 
  ToolRegistry.ts  |   93.23 |    89.23 |   86.95 |   93.23 | ...47-248,251-252 
  ...t-in-tools.ts |     100 |      100 |     100 |     100 |                   
 validation        |   91.18 |    88.88 |   91.66 |   91.18 |                   
  PlanValidator.ts |   91.18 |    88.88 |   91.66 |   91.18 | ...98-304,316-322 
 workflows         |   95.97 |    91.17 |      90 |   95.97 |                   
  ...lowBuilder.ts |   93.75 |    92.85 |   86.66 |   93.75 | ...,36-38,157-158 
  ...-workflows.ts |     100 |    83.33 |     100 |     100 | 28                
-------------------|---------|----------|---------|---------|-------------------
```

---

## 🎬 Live Demo Output (`npm run demo:week3`)

```text
╔════════════════════════════════════════════════════════════════════════════════╗
║   Academia AI Voice Co-Pilot — Week 3 Safe Workflow Engine Live Demo           ║
║   Checkpoint/Resume, Audit Trail, Idempotency & Backend Approval State         ║
╚════════════════════════════════════════════════════════════════════════════════╝

================================================================================
  DEMO 1: Checkpoint & Resume after Failure (D15-16)
================================================================================
Demonstrates: When a workflow encounters a step failure, a snapshot checkpoint is saved.
Resumption continues from the failed step WITHOUT re-running completed steps.

----------------------------------------------------------------------
  Run 1: Initial Execution (Encountering Step 2 Failure)
----------------------------------------------------------------------
  Initial Run Outcome: FAILED (Expected)
  Failed at Step: 'step_2_calc' - Reason: Step 'step_2_calc' execution failed
  ✔ Failure Checkpoint Saved: 'ckpt_fail_wf_demo_recovery_step_2_calc_1795008031241'
    Completed Steps Stored in Checkpoint: [step_1_init]

----------------------------------------------------------------------
  Run 2: Resuming from Checkpoint after Node Recovery
----------------------------------------------------------------------
  Simulating node recovery: clearing transient error...

  Resumed Run Outcome: COMPLETED SUCCESSFULLY
  Final Executed Steps: [step_1_init, step_2_calc, step_3_finalize]
  ✔ CRITICAL INVARIANT: Step 1 re-run count: 0 (NEVER RE-EXECUTED)
  Outputs Available: [ 'normalizedScore', 'step_1_init', 'step_2_calc', 'step_3_finalize' ]

================================================================================
  DEMO 2: Idempotency Keys (D15-16)
================================================================================
Demonstrates: Invoking a tool with an identical idempotency key returns cached output
and guarantees the underlying tool execution runs EXACTLY ONCE.

  [Call 1] Executing tool with idempotencyKey: 'academic_tax_computation_q4'...
    Result: 810
    Served from cache: false
    Underlying tool executions: 1

  [Call 2] Executing duplicate request with same idempotencyKey: 'academic_tax_computation_q4'...
    Result: 810
    Served from cache: true (INSTANT HIT)
    ✔ CRITICAL INVARIANT: Total underlying executions: 1 (ZERO DUPLICATE EXECUTION)

================================================================================
  DEMO 3: Step-Level Cryptographic Audit Trail & Progress Events (D17-18)
================================================================================
Demonstrates: Monotonic 0-100% progress events and immutable SHA-256 hash-chained audit records.

  Listening to live progress events:
    [░░░░░░░░░░░░░░░░░░░░]   0% | Step: step_analyze     | Workflow started
    [░░░░░░░░░░░░░░░░░░░░]   0% | Step: step_analyze     | Executing step Analyze Dataset
    [███████░░░░░░░░░░░░░]  33% | Step: step_analyze     | Completed step Analyze Dataset
    [███████░░░░░░░░░░░░░]  33% | Step: step_calc_stats  | Executing step Calculate Standard Deviation
    [█████████████░░░░░░░]  67% | Step: step_calc_stats  | Completed step Calculate Standard Deviation
    [█████████████░░░░░░░]  67% | Step: step_report      | Executing step Format Report
    [████████████████████] 100% | Step: step_report      | Completed step Format Report
    [████████████████████] 100% | Step: COMPLETED        | Workflow completed successfully

  Verifying Cryptographic Audit Trail Integrity:
    Total Audit Records Captured: 12
    Sample Audit Record Hash Chain:
      Record #1 [WORKFLOW_STARTED]:
        Previous Hash: 4ab5fb0fb40b4288f16248d5...
        Record Hash:   6335b9ae91708f991d2a174c...
      Record #2 [STEP_STARTED]:
        Previous Hash: 6335b9ae91708f991d2a174c...
        Record Hash:   d7863f56e2c3c554d83a6453...
      Record #3 [STEP_COMPLETED]:
        Previous Hash: d7863f56e2c3c554d83a6453...
        Record Hash:   e37a2ae278cedd2dff290cdb...

    ✔ Cryptographic Integrity Verification: PASSED (100% Tamper-Free)

================================================================================
  DEMO 4: Reasoning Proposal & Backend Approval State (D19-20)
================================================================================
Demonstrates: Ingesting a WorkflowProposal with a sensitive tool step and querying backend approval state.

  Proposal Evaluated: ACCEPTED
  Approval Required by Policy: YES (Risk Level C)

  [Safety Gate Notification] Approval required for step 'tool_summary'
  Querying Backend Approval State:
    Status:        PENDING
    Tool Name:     summarize_text
    TTL Remaining: 300s
  Simulating User Approval Decision from UI...
  ✔ Approval submitted to orchestrator.

  Workflow Execution Result: COMPLETED
  Final State: COMPLETED

================================================================================
  DEMO 5: Defense Against Duplicate & Expired Approvals (D19-20)
================================================================================
Demonstrates: Calling approve on an expired approval or duplicate approval NEVER executes a tool.

----------------------------------------------------------------------
  Case 5A: Expired Approval Invariant (0 Tool Invocations)
----------------------------------------------------------------------
  Created approval with 25ms TTL. Waiting 40ms to expire...
  ✔ Expiration correctly prevented approval.
  Execution result success: false (Blocked)
  ✔ CRITICAL INVARIANT: Sensitive tool invocations: 0 (ZERO INVOCATIONS)

----------------------------------------------------------------------
  Case 5B: Duplicate Approval Defense
----------------------------------------------------------------------
  Approving request for the first time...
  Tool executions after first valid approval: 1
  Submitting duplicate approval call...
  ✔ Duplicate approval safely detected: Duplicate decision rejected.
  ✔ CRITICAL INVARIANT: Total tool executions remain: 1 (EXACTLY ONCE, NO DUPLICATE RUNS)

================================================================================
🎉 ALL WEEK 3 (W4) MILESTONES & ACCEPTANCE CRITERIA VERIFIED 100%!
================================================================================
```

---

## 🔒 Security & Privacy Invariants

- **No Secrets or Credentials**: Zero API keys, passwords, or tokens in source code or repository history.
- **No Personal Data**: Zero voice audio recordings, screen captures, or personal data.
- **Default Mock Mode**: All tool executions remain fully simulated through safe in-memory handlers (`calculator`, `summarize_text`).
- **No Unrestricted Computer Control**: Dangerous commands (`bash`, `shell`, `exec`, `terminal`) and external sending (`send_email`, `smtp`, `http_post_external`) are blocked deterministically.
