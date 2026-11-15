# Team SDE 8: Context & Reasoning Engine
**Project:** Academia - AI Voice Co-Pilot  
**Sprint:** Week 3 (W3 - Source-Linked Observations, Grounded Answers & Workflow Handoff)  
**Branch:** `pratiksha-hanji`  
**Location:** `projects/sde-8-voicebot/`

---

## 1. Overview
The **Context & Reasoning Engine** serves as the central intelligence bridge between sensory input layers (Voice STT, Screen OCR, Active Application) and downstream action components (Agent Orchestrator, Safety Gate, Voice TTS).

This module delivers:
1. **Source-Linked Observations & Duplicate/Stale Filtering (D15–16)**: Every observation carries an ISO timestamp and verified `SourceReference`. Stale frames (> 300s TTL) and duplicate frames (detected via SHA-256 content hashes) are dropped automatically.
2. **Consent Revocation & Context Buffer Purge (D15–16)**: Withdrawing consent immediately stops capture and clears all pending in-memory observations and context buffers.
3. **Grounded Answers with Verifiable Citations (D17–18)**: Reasoning responses cite exact application names, window titles, and verifiable quotes.
4. **Honest "No Evidence" Responses (D17–18)**: When context lacks supporting evidence, the engine strictly states no evidence is available instead of guessing or hallucinating facts.
5. **Prompt-Injection Defense & Security Invariance (D19–20)**: Neutralizes delimiter breakouts (`</untrusted_user_query>`, `<system>`), disarms adversarial commands inside screen OCR (`[DISARMED_DANGEROUS_COMMAND]`), and ensures safety classification cannot be bypassed.
6. **WorkflowProposal Handoff (D19–20)**: Schema-validated multi-step `WorkflowProposal` handed off to the workflow module and executed end-to-end in mock mode.
7. **Opt-in Capture Adapter (D8–9)**: Strictly OFF by default until explicit opt-in consent; enforces frame dimension ($\le 1920\times 1080$), byte size ($\le 2\text{ MB}$), and sampling interval ($\ge 500\text{ms}$) limits. Synthetic frames only; real screenshots prohibited.
8. **OCR / Vision Adapter Interface & Mock (D8–9)**: `IOcrVisionAdapter` interface with offline deterministic `MockOcrVisionAdapter`.
9. **Bounded Context Builder (D10–11)**: Recency & relevance selection, heuristic token budget approximation (~4 chars/token), stale filtering, and greedy token packing.
10. **Resilient LLM Client Adapter (D12–13)**: `ILlmClientAdapter` with configurable `timeoutMs`, exponential backoff retry loop, and Zod structured-output validation.

---

## 2. Directory Structure

```text
projects/sde-8-voicebot/
├── prompts/                          # Versioned Prompt Management
│   ├── v1.0.0/
│   │   ├── system.base.md
│   │   ├── persona.developer.md
│   │   ├── persona.researcher.md
│   │   └── persona.general.md
│   └── v1.1.0/
│       └── system.base.md
├── src/
│   ├── schemas/
│   │   ├── context.schema.ts         # Zod ContextItem & SourceReference definitions
│   │   └── reasoning.schema.ts       # ReasoningRequest & ReasoningResult contracts
│   ├── core/
│   │   ├── context-manager.ts        # Session state & privacy redaction
│   │   ├── prompt-loader.ts          # Versioned template loader with XML boundaries
│   │   └── synthetic-frames.ts       # Deterministic test frames (no real screenshots)
│   ├── capture/
│   │   ├── capture.adapter.ts        # Opt-in capture adapter with rate & size limits
│   │   └── ocr-vision.adapter.ts     # IOcrVisionAdapter & MockOcrVisionAdapter
│   ├── builder/
│   │   └── bounded-context-builder.ts# Token budget packing & TTL stale filter
│   ├── llm/
│   │   └── llm.adapter.ts            # ILlmClientAdapter, MockLlmAdapter, retry & validation
│   ├── observations/
│   │   ├── observation.types.ts      # SourceLinkedObservation definitions & errors
│   │   └── observation-store.ts      # Duplicate hash detection, stale filter & consent purge
│   ├── grounding/
│   │   ├── grounding.types.ts        # SourceCitation & GroundedAnswer contracts
│   │   └── grounded-reasoning.service.ts # Citations & honest no-evidence reasoning
│   ├── security/
│   │   └── prompt-injection-guard.ts # Delimiter breakout & adversarial OCR disarming
│   ├── workflow-handoff/
│   │   ├── workflow-proposal.schema.ts # Zod WorkflowProposal schema
│   │   └── workflow-handoff.adapter.ts # Mock orchestrator bridge & end-to-end handoff
│   ├── services/
│   │   └── mock-reasoning.service.ts # Intent reasoning & Safety Level A-D
│   ├── demo.ts                       # Interactive Live Demo runner (11 scenarios)
│   ├── run-tests.ts                  # Comprehensive TypeScript test suite (51 tests)
│   └── index.ts                      # Main module exports
├── tests/
│   └── context-and-reasoning.spec.ts # Jest unit & integration tests
├── jest.config.js
├── package.json
└── tsconfig.json
```

---

## 3. Quick Start & Setup

### Prerequisites
- Node.js (v18 or v20 LTS recommended)
- npm

### Installation
```bash
cd projects/sde-8-voicebot
npm install
```

### Running the Live Demo
Executes 11 interactive scenarios covering Developer Error, PDF Research, Safety Gates, Privacy, Opt-in Capture, Bounded Context, Observations, Consent Revocation, Grounded Citations, Honest No-Evidence, Prompt-Injection Defense, and Workflow Handoff:
```bash
npm run demo
```

### Running Automated Tests
Executes the full 51-test suite verifying Week 1, Week 2, and Week 3 deliverables:
```bash
npm test
```

### Running Jest Test Suite
```bash
npm run test:jest
```

---

## 4. Safety Gate & Risk Classification (PRD Section 18)

| Risk Level | Category | Examples | Approval Required |
|:---:|:---|:---|:---:|
| **Level A** | Informational | Explain code error, explain PDF methodology, date/time query | **No** |
| **Level B** | Low-Risk Interaction | Search files, query documentation index | **No** (Audit Log) |
| **Level C** | Sensitive Action | Move files, modify settings, draft email | **Yes** (User Prompt) |
| **Level D** | Destructive Action | Delete files, format directories, privileged exec | **Yes** (Explicit Modal) |

---

## 5. Pull Request URLs & Verification

### Collaboration Target (Upstream)
* **Target Repository:** [patelhemansi746-oss/voicebot](https://github.com/patelhemansi746-oss/voicebot)
* **Base Branch:** `team/sde-8-voicebot`
* **Compare Branch:** `pratiksha-hanji`
* **Direct PR Creation URL:** [https://github.com/patelhemansi746-oss/voicebot/compare/team/sde-8-voicebot...pratiksha-hanji?expand=1](https://github.com/patelhemansi746-oss/voicebot/compare/team/sde-8-voicebot...pratiksha-hanji?expand=1)

### Personal Fork (Origin)
* **Fork Repository:** [hanjipratiksha-sudo/AI-Co-Pilot-0421](https://github.com/hanjipratiksha-sudo/AI-Co-Pilot-0421)
* **Direct PR URL:** [https://github.com/hanjipratiksha-sudo/AI-Co-Pilot-0421/compare/team/sde-8-voicebot...pratiksha-hanji?expand=1](https://github.com/hanjipratiksha-sudo/AI-Co-Pilot-0421/compare/team/sde-8-voicebot...pratiksha-hanji?expand=1)

---

## 6. Automated Test Output (51/51 Passed - 100%)

```text
Running Team SDE 8 TypeScript Test Suite...

  ✓ PRD Section 19: Redact API keys from context
  ✓ PRD Section 19: Redact Bearer authorization tokens
  ✓ PRD Section 19: Redact passwords
  ✓ Zod Context Schema: Valid payload parses successfully
  ✓ Real Spec Schema: SourceReference validates origin metadata
  ✓ Real Spec Schema: ContextItem validates atomic context item
  ✓ Real Spec Schema: ReasoningRequest parses structured context query
  ✓ Real Spec Schema: ReasoningResult parses engine output with risk level & approval
  ✓ Prompt Loader: Renders v1.0.0 with developer persona
  ✓ Reasoning Service: Developer error is Level A (no approval)
  ✓ Reasoning Service: File move triggers Level C approval gate
  ✓ Reasoning Service: File delete triggers Level D destructive gate
  ✓ Reasoning Service: Current date and time query returns accurate date/time without error diagnosis
  ✓ Reasoning Service: Conversational greeting returns assistant capabilities
  ✓ PRD Section 19: Screen capture is strictly disabled and stays disabled
  ✓ PRD Section 19: Live capture attempt throws error (Synthetic frames only, no real screenshots)
  ✓ Synthetic Frames: Available frames list contains 4 compliant test frames
  ✓ Synthetic Frames: Loading frame generates valid ContextItem with SourceReference
  ✓ Prompt Security: Trusted and untrusted blocks are separated with XML boundaries
  ✓ Prompt Security: Prompt injection tags inside untrusted query are neutralized
  ✓ Reasoning Engine: reason() executes ReasoningRequest and outputs valid ReasoningResult
  ✓ Week 2 Capture: Off by default (isOptedIn is false)
  ✓ Week 2 Capture: Throws CaptureNotOptedInError when unconsented capture is attempted
  ✓ Week 2 Capture: optIn() enables capture, optOut() disables it
  ✓ Week 2 Capture: Throws RealScreenshotNotAllowedError if isSynthetic is false
  ✓ Week 2 Capture: Throws FrameDimensionExceededError if frame exceeds max dimensions
  ✓ Week 2 Capture: Throws FrameSizeExceededError if byte size exceeds maximum threshold
  ✓ Week 2 Capture: Throws SamplingRateExceededError when frames captured faster than minSamplingIntervalMs
  ✓ Week 2 OCR/Vision: MockOcrVisionAdapter extracts structured lines, words & confidence
  ✓ Week 2 OCR/Vision: MockOcrVisionAdapter detects application and structured UI elements
  ✓ Week 2 Builder: Approximates token count at ~4 chars per token
  ✓ Week 2 Builder: Stale filtering evicts items exceeding TTL (300s)
  ✓ Week 2 Builder: Relevance and recency ranking prioritizes query-matching items
  ✓ Week 2 Builder: Strict token budget truncates overflowing candidate items
  ✓ Week 2 LLM: Executes structured output matching ReasoningResultSchema
  ✓ Week 2 LLM: Timeout triggers LlmTimeoutError within specified threshold
  ✓ Week 2 LLM: Exponential backoff retries transient failures and eventually succeeds
  ✓ Week 2 Malformed Output: Non-JSON raw text throws LlmMalformedOutputError without retry
  ✓ Week 2 Malformed Output: Valid JSON violating Zod schema throws LlmValidationError with issues
  ✓ Week 3 Observations: Timestamped & source-linked observations carry valid metadata
  ✓ Week 3 Observations: Duplicate frames are detected via content hash and dropped
  ✓ Week 3 Observations: Stale frames exceeding TTL are dropped
  ✓ Week 3 Observations: Consent withdrawal halts capture and purges pending context
  ✓ Week 3 Grounding: Grounded answers cite exact source references and quotes
  ✓ Week 3 Grounding: When context lacks evidence, response states no evidence instead of guessing
  ✓ Week 3 Security: Direct prompt injection delimiters and system tags are disarmed
  ✓ Week 3 Security: Instructions inside screen OCR are treated as passive data and never executed
  ✓ Week 3 Workflow Handoff: Valid WorkflowProposal parses cleanly through schema
  ✓ Week 3 Workflow Handoff: Invalid proposal missing steps throws WorkflowProposalValidationError
  ✓ Week 3 Workflow Handoff: Hands off proposal and executes end-to-end in mock mode
  ✓ Week 3 Workflow Handoff: Sensitive Level C/D proposal pauses for human approval

Test Results: 51/51 passed (100%)
```
