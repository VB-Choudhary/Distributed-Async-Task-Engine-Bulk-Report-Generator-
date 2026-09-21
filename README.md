# Report Generator

Async bulk invoice & PDF report generation system.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js LTS |
| Language | TypeScript (strict) |
| HTTP | Express |
| Queue | BullMQ + ioredis |
| Database | PostgreSQL via `pg` + `node-pg-migrate` |
| Validation | Zod |
| Logging | pino + pino-http |
| PDF generation | pdfkit |
| Testing | vitest + supertest |
| Linting | ESLint + Prettier |
| Containers | Docker Desktop + Docker Compose |

## Quick Start

```cmd
REM 1. Copy the example env file and edit as needed
copy .env.example .env

REM 2. Install dependencies
npm install

REM 3. Start the development server (auto-restarts on file changes)
npm run dev
```

The server starts on `http://localhost:3000` by default.

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with file-watching via tsx |
| `npm run build` | Compile TypeScript → `dist/` via tsup |
| `npm start` | Run the compiled production build |
| `npm run lint` | Run ESLint across all TypeScript files |
| `npm run format` | Auto-format with Prettier |
| `npm run typecheck` | Run `tsc --noEmit` for type errors only |
| `npm test` | Run all tests with vitest |

## Project Structure

```
src/
  config/
    env.ts          # Zod-validated environment config — validated at startup
  lib/
    logger.ts       # Shared pino logger + request-id HTTP middleware
  api/
    app.ts          # Express app factory (createApp) — no listen()
    server.ts       # Process entry point — binds port, handles signals
  types/
    express.d.ts    # Augments Express.Request with requestId field
tests/
  health.test.ts    # Integration tests: health endpoint, 404, error handler
  env.test.ts       # Unit tests: env validation, defaults, invalid values
```

## API Endpoints

### `GET /health`

Returns HTTP 200 when the process is alive.

```json
{ "status": "ok" }
```

## Environment Variables

See [`.env.example`](.env.example) for the full list with descriptions and defaults.

## Development Notes

- All env vars are validated at startup via Zod. The process exits immediately
  with a clear error message if any value is missing or invalid.
- Every HTTP request is assigned a UUID (`x-request-id` response header).
  Upstream systems can supply their own ID via the `x-request-id` request header.
- Stack traces are only included in error responses when `NODE_ENV=development`.

## Phases

- **Phase 1 (current)**: Project foundation — Express skeleton, config, logging, tests
- Phase 2: PostgreSQL integration + migrations
- Phase 3: BullMQ queue + worker
- Phase 4: Report generation (PDF / CSV via pdfkit)
- Phase 5: Docker Compose orchestration
