# SDE-8 Voicebot: Backend & Sessions (Week 1)

> **Task Assignment:** W5 – Backend & Sessions: App Skeleton, Middleware, Mock Session Route & Launcher  
> **Team:** SDE 8  
> **Project Directory:** `projects/sde-8-voicebot/`  
> **Target Git Branch:** `team/sde-8-voicebot`  
> **Upstream Repository:** `https://github.com/ashuudevang/acd_voicebot`

---

## 📖 Overview

This module provides the core backend foundation for the **Academia - AI Voice Co-Pilot** platform. It implements a TypeScript-based Express.js application skeleton, structured middleware pipeline (CORS, JSON parsing, logging, error handling, Zod validation), full in-memory mock session management endpoints, an orchestration service launcher script, and a test suite with >80% test coverage.

---

## 🏗️ Architecture & Project Structure

```
projects/sde-8-voicebot/
├── .env.example                  # Template environment variables
├── .env                          # Local environment variables
├── .gitignore                    # Git ignore file
├── jest.config.js                # Jest test configuration with >80% coverage threshold
├── package.json                  # NPM scripts & dependencies
├── README.md                     # Complete project documentation
├── tsconfig.json                 # TypeScript compiler configuration
├── src/
│   ├── app.ts                    # Express app instantiation and middleware pipeline
│   ├── server.ts                 # Server entrypoint with graceful shutdown
│   ├── config/
│   │   ├── env.ts                # Environment variable parsing and type safety
│   │   └── launcher.config.ts    # Service orchestrator configuration
│   ├── controllers/
│   │   └── session.controller.ts # Request handlers for session endpoints
│   ├── middleware/
│   │   ├── cors.middleware.ts    # CORS origin handling and allowed headers
│   │   ├── error.middleware.ts   # Centralized AppError and 404/500 handlers
│   │   ├── logger.middleware.ts  # Structured request/response logger with latency
│   │   └── validate.middleware.ts# Zod schema validation middleware
│   ├── routes/
│   │   ├── health.routes.ts      # GET /health service monitoring endpoint
│   │   └── session.routes.ts     # CRUD + context update session routes
│   ├── scripts/
│   │   └── launcher.ts           # Service orchestration and lifecycle tool
│   ├── services/
│   │   └── session.service.ts    # In-memory mock session store & business logic
│   └── types/
│       ├── common.types.ts       # Unified API response formats
│       └── session.types.ts      # Session models, DTOs & Zod schemas
└── tests/
    ├── unit/
    │   ├── error.middleware.test.ts # Unit tests for AppError and error handlers
    │   ├── logger.middleware.test.ts# Unit tests for request logging
    │   └── session.service.test.ts  # Unit tests for session repository logic
    ├── integration/
    │   ├── health.routes.test.ts    # Integration tests for health check
    │   └── session.routes.test.ts   # Integration tests for all session REST APIs
    └── smoke/
        └── launcher.test.ts         # Smoke tests for service launcher orchestrator
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.x or v20.x+ LTS ([Download Node.js](https://nodejs.org/))
- **npm**: v9.x or higher

### 2. Installation
Navigate to this directory and install dependencies:
```bash
cd projects/sde-8-voicebot
npm install
```

### 3. Environment Configuration
The `.env` file is pre-configured with default values:
```env
PORT=5000
NODE_ENV=development
API_PREFIX=/api/v1
CORS_ORIGIN=*
SESSION_TIMEOUT_MINUTES=30
MAX_CONCURRENT_SESSIONS=100
LAUNCHER_SERVICE_NAME=sde-8-voicebot-backend
LAUNCHER_HEALTH_CHECK_PATH=/health
LAUNCHER_RETRY_LIMIT=3
```

---

## 💻 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts server in live-reload development mode via `ts-node-dev` |
| `npm run build` | Compiles TypeScript into JavaScript (`dist/`) |
| `npm start` | Runs compiled production server (`dist/server.js`) |
| `npm run launcher` | Launches service orchestrator (pre-flight checks, spawn, health polling) |
| `npm test` | Executes Jest test suite and generates code coverage report |
| `npm run test:unit` | Runs only unit tests |
| `npm run test:integration` | Runs only API integration tests |
| `npm run lint` | Runs TypeScript type-checking without emitting files |

---

## 📡 API Specification

All responses adhere to a consistent contract:
```json
{
  "success": true,
  "message": "Optional descriptive status message",
  "data": {},
  "timestamp": "2026-11-01T11:15:00.000Z"
}
```

### Health Check
- **`GET /health`**
  - **Description**: Verifies service status and system uptime.
  - **Response 200**:
    ```json
    {
      "success": true,
      "message": "Voicebot backend service is healthy",
      "data": {
        "status": "UP",
        "uptime": 12.34,
        "timestamp": "2026-11-01T11:15:00.000Z"
      }
    }
    ```

### Session Endpoints
Base URL: `/api/v1/sessions`

#### 1. Create Voice Session
- **`POST /api/v1/sessions`**
- **Body**:
  ```json
  {
    "userId": "intern-dev-123",
    "initialContext": {
      "activeApplication": "VS Code",
      "windowTitle": "server.ts",
      "documentType": "typescript",
      "visibleContentSnippet": "console.log('Voicebot running');"
    },
    "metadata": {
      "team": "SDE-8"
    }
  }
  ```
- **Response 201 Created**:
  ```json
  {
    "success": true,
    "message": "Voice session created successfully",
    "data": {
      "id": "18f7d91e-bcfc-4d30-a89a-0a7e0a2939e0",
      "userId": "intern-dev-123",
      "status": "active",
      "createdAt": "2026-11-01T11:15:00.000Z",
      "updatedAt": "2026-11-01T11:15:00.000Z",
      "lastActivity": "2026-11-01T11:15:00.000Z",
      "context": {
        "activeApplication": "VS Code",
        "windowTitle": "server.ts",
        "documentType": "typescript",
        "visibleContentSnippet": "console.log('Voicebot running');",
        "lastUpdated": "2026-11-01T11:15:00.000Z"
      },
      "metadata": { "team": "SDE-8" }
    }
  }
  ```

#### 2. List All Sessions
- **`GET /api/v1/sessions?page=1&limit=20`**
- **Response 200 OK**:
  ```json
  {
    "success": true,
    "data": {
      "sessions": [ ... ],
      "total": 1
    }
  }
  ```

#### 3. Get Session by ID
- **`GET /api/v1/sessions/:id`**
- **Response 200 OK**: Details for matching session.
- **Response 404 Not Found**: If session ID is not present.

#### 4. Update Session Status
- **`PATCH /api/v1/sessions/:id/status`**
- **Body**:
  ```json
  { "status": "paused" }
  ```
  *(Allowed values: `active`, `paused`, `idle`, `terminated`)*

#### 5. Update Session Context
- **`PATCH /api/v1/sessions/:id/context`**
- **Body**:
  ```json
  {
    "activeApplication": "Chrome",
    "windowTitle": "PRD - Academia Voice Co-Pilot"
  }
  ```

#### 6. Delete / Terminate Session
- **`DELETE /api/v1/sessions/:id`**
- **Response 200 OK**:
  ```json
  {
    "success": true,
    "message": "Session '18f7d91e-bcfc-4d30-a89a-0a7e0a2939e0' successfully terminated"
  }
  ```

---

## 🧪 Testing & Code Coverage (>80%)

Run all tests with Jest:
```bash
npm test
```
The test suite validates:
- **Unit Tests**:
  - `error.middleware.test.ts`: Error status codes, JSON payload formatting, and operational error handling.
  - `logger.middleware.test.ts`: Request logging formatting, status code tracking, and duration measurement.
  - `session.service.test.ts`: CRUD in-memory state mutations, pagination, and boundary limits.
- **Integration Tests**:
  - `health.routes.test.ts`: Health check endpoint and 404 routing.
  - `session.routes.test.ts`: End-to-end HTTP request/response validation, schema validation rejections (400), and not found checks (404).
- **Smoke Tests**:
  - `launcher.test.ts`: Environment validation, service configuration, and process lifecycle teardown.

---

## 🛠️ Service Launcher Orchestrator

The launcher tool (`src/scripts/launcher.ts`) coordinates multi-service environments:
1. Runs pre-flight diagnostics (validates Node.js runtime and environment configuration).
2. Spawns service processes cleanly with standard stream redirection.
3. Performs active HTTP health checks (`/health`) with automated retries.
4. Handles graceful termination (`SIGINT` / `SIGTERM`) across all active services.

Run the launcher:
```bash
npm run launcher
```

---

## 📋 Acceptance Criteria Checklist

- [x] **Express server starts without errors** (`src/app.ts`, `src/server.ts`)
- [x] **All middleware functions correctly** (CORS, JSON body parser, structured logging, centralized AppError handler, Zod request validator)
- [x] **Session endpoints are fully functional** (`POST`, `GET`, `PATCH`, `DELETE` with pagination and context updates)
- [x] **Test coverage >80%** (configured in `jest.config.js` with unit, integration, and smoke test coverage)
- [x] **Launcher correctly starts all services** (`src/scripts/launcher.ts` with pre-flight checks and health polling)
- [x] **Documentation complete** (`README.md` with setup, API specification, test guidelines, and Git PR instructions)

---

## 🔀 Git Workflow & PR Submission

When ready to submit your work to the team repository:

```bash
# 1. Initialize git and switch to team branch
git checkout -b team/sde-8-voicebot

# 2. Stage your project files
git add projects/sde-8-voicebot/

# 3. Commit changes according to conventional commits
git commit -m "feat(backend): implement Express skeleton, middleware, mock session routes, and launcher"

# 4. Push to origin
git push -u origin team/sde-8-voicebot

# 5. Open Pull Request on GitHub
# Target: https://github.com/ashuudevang/acd_voicebot
# Base branch: main (or team/sde-8-voicebot as specified by lead)
```

