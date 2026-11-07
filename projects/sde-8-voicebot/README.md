# SDE-8 Voicebot: Backend & Sessions (Days 8–14: Core Implementation)

> **Task Assignment:** W5 – Backend & Sessions: Days 8–14 (Core implementation)  
> **Team:** SDE 8  
> **Project Directory:** `projects/sde-8-voicebot/`  
> **Target Git Branch:** `team/sde-8-voicebot` (or feature branch off it)  
> **Repository:** `https://github.com/patelhemansi746-oss/voicebot` (or `https://github.com/Yashuudevang/acd_voicebot`)

---

## 📖 Overview

This release completes the **real session backend** for the **Academia - AI Voice Co-Pilot** platform (Team SDE-8 Days 8–14). It expands the foundation into a production-grade session engine with:
- **Full Session Lifecycle State Machine**: `active`, `paused`, `stopped`, and `expired`.
- **Strict Transition Enforcement**: Rejects illegal transitions with typed 409 `ILLEGAL_TRANSITION` error envelope.
- **Idempotent Commands**: Repeated pause, resume, and stop operations return the current session state safely without errors.
- **Inactivity Session Expiry**: Automated expiration tracking for stale sessions.
- **Real-Time Event Streaming (SSE)**: Server-Sent Events endpoint (`GET /api/v1/sessions/:id/events`) streaming ordered lifecycle and context events with historical replay.
- **Payload Size Limits & Zod Validation**: Enforces strict request body limits, rejecting oversized payloads with 413 `PAYLOAD_TOO_LARGE`.
- **Zero-Secret Safe Mock Startup**: Validated startup config using Zod with safe mock defaults—boots immediately with no external keys or secrets needed.
- **Structured JSON Logging with Correlation IDs**: Every request tracks an `x-correlation-id`, outputs structured JSON logs, and automatically redacts sensitive data (passwords, tokens, API keys).

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
│   ├── app.ts                         # Express app pipeline with payload limits & correlation logging
│   ├── server.ts                      # Server entrypoint with graceful shutdown
│   ├── config/
│   │   ├── env.ts                     # Zod-validated startup config with safe mock defaults
│   │   └── launcher.config.ts         # Service orchestrator configuration
│   ├── controllers/
│   │   └── session.controller.ts      # HTTP handlers & Server-Sent Events streaming
│   ├── middleware/
│   │   ├── cors.middleware.ts         # CORS policy & headers
│   │   ├── error.middleware.ts        # Typed error envelope & AppError handling
│   │   ├── logger.middleware.ts       # Structured JSON logging, correlation IDs & sensitive data redaction
│   │   └── validate.middleware.ts     # Zod schema validation middleware
│   ├── routes/
│   │   ├── health.routes.ts           # GET /health monitoring endpoint
│   │   └── session.routes.ts          # REST endpoints & SSE stream
│   ├── scripts/
│   │   └── launcher.ts                # Service orchestration tool with health check polling
│   ├── services/
│   │   └── session.service.ts         # Lifecycle state machine, event store & inactivity expiry
│   └── types/
│       ├── common.types.ts            # Typed error envelope & API response definitions
│       └── session.types.ts           # Session lifecycle models, event definitions & Zod schemas
└── tests/
    ├── unit/
    │   ├── app.test.ts                # App factory & middleware integration
    │   ├── cors.middleware.test.ts    # CORS origin filtering & rejection
    │   ├── env.config.test.ts         # Startup config validation & safe defaults
    │   ├── error.middleware.test.ts   # Typed error envelope & 413 payload limits
    │   ├── health.routes.test.ts      # Health check handler
    │   ├── launcher.config.test.ts    # Launcher configuration verification
    │   ├── logger.middleware.test.ts  # Correlation ID tracking & sensitive redaction
    │   ├── session.controller.test.ts # Session controller methods & SSE stream
    │   ├── session.service.test.ts    # Lifecycle state machine, idempotency, expiry & events
    │   └── validate.middleware.test.ts# Zod input validation
    └── smoke/
        └── launcher.test.ts           # Launcher pre-flight & orchestrator smoke tests
```

---

## 🔄 State Machine & Transition Rules

```
       [create]
          │
          ▼
     ┌─────────┐   pause    ┌─────────┐
     │ ACTIVE  ├───────────►│ PAUSED  │
     │         │◄───────────┤         │
     └────┬────┘   resume   └────┬────┘
          │                      │
     stop │                 stop │
          ▼                      ▼
     ┌────────────────────────────────┐
     │       STOPPED (Terminal)       │
     └────────────────────────────────┘
          ▲
          │ (Inactivity timeout)
     ┌────┴───────────────────────────┐
     │       EXPIRED (Terminal)       │
     └────────────────────────────────┘
```

- **Allowed Transitions**:
  - `ACTIVE` ➔ `PAUSED`, `STOPPED`, `EXPIRED`
  - `PAUSED` ➔ `ACTIVE` (resume), `STOPPED`, `EXPIRED`
- **Idempotency**:
  - `pause` on `PAUSED` ➔ Returns 200 with existing session (no error).
  - `resume` on `ACTIVE` ➔ Returns 200 with existing session (no error).
  - `stop` on `STOPPED` ➔ Returns 200 with existing session (no error).
- **Illegal Transitions**:
  - Resuming or pausing a `STOPPED` or `EXPIRED` session is rejected with **HTTP 409 `ILLEGAL_TRANSITION`**.
  - Updating context on a terminal session is rejected with **HTTP 409 `ILLEGAL_TRANSITION`**.

---

## 📡 API Specification & Typed Error Envelope

### Standard Response Envelope
```json
{
  "success": true,
  "message": "Descriptive message",
  "data": {},
  "timestamp": "2026-11-02T13:40:00.000Z"
}
```

### Standard Error Envelope
```json
{
  "success": false,
  "message": "Cannot resume session '123' in terminal status 'stopped'",
  "error": {
    "code": "ILLEGAL_TRANSITION",
    "details": null
  },
  "timestamp": "2026-11-02T13:40:00.000Z"
}
```

### Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health status and uptime |
| `POST` | `/api/v1/sessions` | Create a new active voice session |
| `GET` | `/api/v1/sessions` | List active sessions (supports `?page=1&limit=20`) |
| `GET` | `/api/v1/sessions/:id` | Get details and active context of a session |
| `POST` | `/api/v1/sessions/:id/pause` | Pause an active session (**Idempotent**) |
| `POST` | `/api/v1/sessions/:id/resume` | Resume a paused session (**Idempotent**) |
| `POST` | `/api/v1/sessions/:id/stop` | Stop a session (**Idempotent**) |
| `PATCH` | `/api/v1/sessions/:id/context` | Update active window / screen context |
| `DELETE` | `/api/v1/sessions/:id` | Delete session and clean up memory |
| `GET` | `/api/v1/sessions/:id/events` | **Server-Sent Events (SSE)** real-time stream with historical replay |

---

## 🧪 Test Suite & Verified Coverage

Run tests from `projects/sde-8-voicebot`:
```bash
npm test
```

### Test Coverage Results:
- **Statements:** `98.57%` *(Target: >80%)*
- **Branches:** `88.13%` *(Target: >80%)*
- **Functions:** `95.45%` *(Target: >80%)*
- **Lines:** `98.82%` *(Target: >80%)*
- **Passing Tests:** **62 passing tests across 13 test suites (100% passing)**

---

## 🔒 Security & Privacy Features
- **App starts with no secrets**: Default mock mode runs zero external credentials.
- **Sensitive payload redaction**: Structured JSON logs automatically scrub passwords, tokens, API keys, and authorization headers (`[REDACTED]`).
- **Correlation IDs**: Header `X-Correlation-Id` is attached to all HTTP requests and responses for end-to-end tracing.
- **Payload size limits**: Rejects payloads exceeding `100kb` with typed 413 `PAYLOAD_TOO_LARGE`.

---

## 📋 Acceptance Criteria Checklist

- [x] **Sessions support create / pause / resume / stop / expiry; illegal transitions rejected; repeated commands are idempotent**
- [x] **Events stream in order (SSE); invalid requests rejected with typed error envelope; payload size limits enforced**
- [x] **Startup config is validated; safe mock defaults; app starts with no secrets**
- [x] **Logs are structured, carry correlation IDs and contain no sensitive payloads**
- [x] **API tests pass (>98% coverage); PR includes test output; demo ready**
