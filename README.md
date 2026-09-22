# Bulk Invoice & PDF Report Generator

An asynchronous job-processing system. Clients submit report parameters; the API returns HTTP 202 with a job ID; a separate worker process pulls jobs from a Redis queue (BullMQ), generates PDF or CSV reports in the background, and records state in PostgreSQL.

---

## Architecture & Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js LTS |
| Language | TypeScript (strict mode) |
| HTTP Server | Express |
| Job Queue | BullMQ + ioredis |
| Database | PostgreSQL via `pg` + `node-pg-migrate` |
| Config Validation | Zod |
| Structured Logging | Pino + pino-http |
| Document Generation | PDFKit |
| Testing | Vitest + Supertest |
| Linting & Formatting | ESLint 10 (Flat Config) + Prettier |
| Infrastructure | Docker Desktop + Docker Compose |

---

## Quick Start (Windows Command Prompt)

### 1. Prerequisites
- **Node.js LTS** (>= 20.0.0)
- **Git**
- **Docker Desktop** installed and running on Windows

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```cmd
copy .env.example .env
```
*(The defaults are pre-configured to connect to local Docker containers for PostgreSQL and Redis)*

### 3. Install Dependencies
```cmd
npm install
```

### 4. Start Local Infrastructure (PostgreSQL & Redis)
Ensure Docker Desktop is running, then run:
```cmd
npm run infra:up
```

Verify containers are running and healthy:
```cmd
docker compose ps
```

### 5. Start Development Server
```cmd
npm run dev
```
The server will start on `http://localhost:3000` with hot-reloading enabled.

---

## Local Infrastructure Management

| Command | Action |
|---|---|
| `npm run infra:up` | Starts PostgreSQL (`localhost:5432`) and Redis (`localhost:6379`) in the background. |
| `npm run infra:down` | Stops containers while **preserving** database and queue data in named volumes. |
| `npm run infra:reset` | **Destructive**: Stops containers and permanently removes all database and queue volumes (`docker compose down -v`). |

---

## Endpoints

### 1. `GET /health`
- **Purpose**: Pure liveness check for process restarts and load balancers.
- **Dependencies**: None checked.
- **Response**: `200 OK`
  ```json
  { "status": "ok" }
  ```

### 2. `GET /ready`
- **Purpose**: Dependency readiness check before routing user traffic.
- **Dependencies**: Executes `SELECT 1` on PostgreSQL and `PING` on Redis.
- **Healthy Response**: `200 OK`
  ```json
  {
    "status": "ready",
    "dependencies": {
      "postgres": { "status": "up", "latencyMs": 3 },
      "redis": { "status": "up", "latencyMs": 1 }
    }
  }
  ```
- **Unhealthy Response**: `503 Service Unavailable`
  ```json
  {
    "status": "not_ready",
    "dependencies": {
      "postgres": { "status": "down", "error": "connect ECONNREFUSED 127.0.0.1:5432" },
      "redis": { "status": "up", "latencyMs": 1 }
    }
  }
  ```

---

## Windows & Docker Troubleshooting Guide

### 1. "Cannot connect to the Docker API" / Docker daemon not running
**Symptom:**
```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```
**Fix:**
1. Open the Start menu, search for **Docker Desktop**, and open it.
2. Wait for the whale icon in the Windows notification tray to stop animating and show "Docker Desktop is running".
3. Verify in Command Prompt:
   ```cmd
   docker info
   ```

### 2. Port Conflict: Port 5432 or 6379 already in use
**Symptom:**
```
Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:5432 -> 0.0.0.0:0: listen tcp 0.0.0.0:5432: bind: address already in use
```
**Fix:**
You may have a local Windows PostgreSQL or Redis service running in the background.
1. Identify the process listening on port 5432 or 6379:
   ```cmd
   netstat -ano | findstr :5432
   netstat -ano | findstr :6379
   ```
2. Note the PID (the number at the far right of the line).
3. If it is a Windows service (e.g. `postgresql-x64-16`), open `services.msc` and set the service to "Manual" or "Stopped".
4. Alternatively, kill the conflicting process by PID:
   ```cmd
   taskkill /PID <PID_NUMBER> /F
   ```

### 3. PowerShell Script Execution Restrictions
**Symptom:**
```
npm.ps1 cannot be loaded because running scripts is disabled on this system
```
**Fix:**
Always use standard Windows Command Prompt (`cmd.exe`) rather than PowerShell, or invoke commands using `cmd /c`:
```cmd
cmd /c "npm run infra:up"
```

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Runs development server with tsx watch |
| `npm run build` | Compiles application to `dist/server.js` using tsup |
| `npm start` | Executes compiled production code |
| `npm run lint` | Runs ESLint 10 checks across source and tests |
| `npm run format` | Auto-formats code with Prettier |
| `npm run typecheck` | Typechecks project with strict TypeScript settings |
| `npm test` | Runs Vitest test suites |
| `npm run infra:up` | Starts Postgres & Redis containers in Docker |
| `npm run infra:down` | Stops containers preserving data |
| `npm run infra:reset` | Stops containers and drops volume data |
