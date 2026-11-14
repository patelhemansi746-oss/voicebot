# SDE-8 Voicebot: Backend & Sessions (Week 1 & Week 2 Implementation)

> **Task Assignment:** W5 – Backend & Sessions: Week 1 & Week 2 (Core implementation & Hardening)  
> **Team:** SDE 8  
> **Project Directory:** `projects/sde-8-voicebot/`  
> **Target Git Branch:** `team/sde-8-voicebot` (or `jahnavi`)  
> **Repository:** `https://github.com/patelhemansi746-oss/voicebot` (or `jahnavipatil11/VOICEBOT-AI-CO-POLIT`)

---

## 📖 Overview

This release completes both **Week 1** and **Week 2** requirements for the **Academia - AI Voice Co-Pilot** platform (Team SDE-8). It features:
- **7-State Session Lifecycle State Machine**: Formal state transitions across `created`, `active`, `paused`, `stopping`, `completed`, `failed`, and `expired`.
- **Strict Transition Enforcement**: Rejects illegal transitions on terminal states with typed 409 `ILLEGAL_TRANSITION` error envelope.
- **Idempotent Commands**: Repeated `start`, `pause`, `resume`, and `stop` operations return the current session state safely without errors.
- **Readiness & Liveness Endpoints**: `GET /ready` (and `GET /health/ready`) for container readiness probes, and `GET /health` for liveness probes.
- **Typed Error Envelope**: Adheres to the specification with `code`, `message_safe_for_user`, `retryable`, `correlation_id`, and `details_redacted`.
- **Request ID & Correlation ID Tracking**: Middleware sets `X-Request-ID` and `X-Correlation-Id` on all requests and responses.
- **Real-Time Event Streaming (SSE)**: Server-Sent Events endpoint (`GET /api/v1/sessions/:id/events`) streaming ordered lifecycle and context events with historical replay.
- **Payload Size Limits & Zod Validation**: Enforces strict request body limits, rejecting oversized payloads with 413 `PAYLOAD_TOO_LARGE`.
- **Zero-Secret Safe Mock Startup**: Validated startup config using Zod with safe mock defaults—boots immediately with no external keys or secrets needed.
- **Structured JSON Logging with Redaction**: Structured JSON logs automatically scrub sensitive data (passwords, tokens, API keys).

---

## 🏗️ Architecture & Project Structure

```
projects/sde-8-voicebot/
├── .env.example                       # Template environment variables (safe mock defaults)
├── .env                               # Local configuration
├── .gitignore                         # Dependencies and build ignore rules
├── jest.config.js                     # Jest config enforcing >80% coverage threshold
├── package.json                       # Scripts & dependencies
├── README.md                          # Complete documentation & API contracts
├── tsconfig.json                      # Strict TypeScript configuration
├── src/
│   ├── app.ts                         # Express app pipeline with payload limits, request ID & error handling
│   ├── server.ts                      # Server entrypoint with graceful shutdown
│   ├── config/
│   │   ├── env.ts                     # Zod-validated startup config with safe mock defaults
│   │   └── launcher.config.ts         # Service orchestrator configuration
│   ├── controllers/
│   │   └── session.controller.ts      # HTTP handlers & Server-Sent Events streaming
│   ├── middleware/
│   │   ├── cors.middleware.ts         # CORS policy & headers
│   │   ├── error.middleware.ts        # Typed error envelope & AppError handling
│   │   ├── logger.middleware.ts       # Structured JSON logging & sensitive data redaction
│   │   ├── request-id.middleware.ts   # X-Request-ID & X-Correlation-Id generation/tracking
│   │   └── validate.middleware.ts     # Zod schema validation middleware
│   ├── routes/
│   │   ├── health.routes.ts           # GET /health & GET /ready monitoring endpoints
│   │   └── session.routes.ts          # REST endpoints & SSE stream
│   ├── scripts/
│   │   ├── demo.ts                    # End-to-end demo script
│   │   └── launcher.ts                # Service orchestration tool with health check polling
│   ├── services/
│   │   └── session.service.ts         # 7-state lifecycle state machine, event store & inactivity expiry
│   └── types/
│       ├── common.types.ts            # Typed error envelope & API response definitions
│       └── session.types.ts           # Session lifecycle models, event definitions & Zod schemas
└── tests/
    ├── helpers/
    │   └── test-request.ts            # High-performance in-memory named pipe HTTP testing harness
    ├── unit/
    │   ├── app.test.ts                # App factory & middleware integration
    │   ├── cors.middleware.test.ts    # CORS origin filtering & rejection
    │   ├── env.config.test.ts         # Startup config validation & safe defaults
    │   ├── error.middleware.test.ts   # Typed error envelope & payload limits
    │   ├── health.routes.test.ts      # Health & readiness handlers
    │   ├── launcher.config.test.ts    # Launcher configuration verification
    │   ├── logger.middleware.test.ts  # Structured logging & sensitive redaction
    │   ├── request-id.middleware.test.ts # Request ID & correlation ID middleware tests
    │   ├── session.controller.test.ts # Session controller methods & SSE stream
    │   ├── session.service.test.ts    # 7-state lifecycle machine, idempotency, expiry & events
    │   └── validate.middleware.test.ts# Zod input validation
    ├── integration/
    │   ├── health.routes.test.ts      # Route integration for /health, /ready, request IDs & errors
    │   └── session.routes.test.ts     # Route integration for 7 states & SSE replay
    └── smoke/
        └── launcher.test.ts           # Launcher pre-flight & orchestrator smoke tests
```

---

## 🔄 7-State Lifecycle State Machine

```
              [createSession]
                    │
                    ▼
               ┌─────────┐
               │ CREATED │
               └────┬────┘
                    │ start / resume
                    ▼
     ┌─────────┐  pause   ┌─────────┐
     │ ACTIVE  ├─────────►│ PAUSED  │
     │         │◄─────────┤         │
     └────┬────┘  resume  └────┬────┘
          │                    │
     stop │               stop │
          ▼                    ▼
     ┌──────────────────────────────┐
     │           STOPPING           │
     └──────────────┬───────────────┘
                    │ teardown
                    ▼
     ┌──────────────────────────────┐
     │     COMPLETED (Terminal)     │
     └──────────────────────────────┘

     * Any non-terminal state ──► FAILED (Terminal) on fatal error
     * Any non-terminal state ──► EXPIRED (Terminal) on inactivity timeout
```

- **Allowed Transitions**:
  - `created` ➔ `active`, `stopping`, `failed`, `expired`
  - `active` ➔ `paused`, `stopping`, `failed`, `expired`
  - `paused` ➔ `active`, `stopping`, `failed`, `expired`
  - `stopping` ➔ `completed`, `failed`
- **Terminal States**: `completed`, `failed`, `expired`. Any transition attempt from a terminal state throws `409 ILLEGAL_TRANSITION`.

---

## 🛡️ Standard Typed Error Envelope

```json
{
  "success": false,
  "message": "Human readable safe message",
  "error": {
    "code": "VALIDATION_ERROR",
    "message_safe_for_user": "Human readable safe message",
    "retryable": false,
    "correlation_id": "c138b301-3dd8-4107-88d4-539424c883e0",
    "details_redacted": {
      "field": "userId"
    }
  },
  "timestamp": "2026-11-14T13:14:04.742Z"
}
```

---

## 🌐 API Reference

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/health` | Service liveness probe (`UP`) |
| `GET` | `/ready` | Service readiness probe (`READY`) |
| `GET` | `/health/ready` | Readiness probe under health router |
| `POST` | `/api/v1/sessions` | Create new voice session (`created` status) |
| `GET` | `/api/v1/sessions` | List sessions with pagination |
| `GET` | `/api/v1/sessions/:id` | Get session details |
| `POST` | `/api/v1/sessions/:id/start` | Start created session (`active` status) |
| `POST` | `/api/v1/sessions/:id/pause` | Pause active session (`paused` status, idempotent) |
| `POST` | `/api/v1/sessions/:id/resume` | Resume paused session (`active` status, idempotent) |
| `POST` | `/api/v1/sessions/:id/stop` | Stop session (`stopping` ➔ `completed`, idempotent) |
| `POST` | `/api/v1/sessions/:id/fail` | Fail session (`failed` status) |
| `PATCH` | `/api/v1/sessions/:id/context` | Update desktop workspace context |
| `DELETE` | `/api/v1/sessions/:id` | Delete session & event history |
| `GET` | `/api/v1/sessions/:id/events` | SSE event stream with ordered historical replay |
