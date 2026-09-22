/**
 * src/api/app.ts
 *
 * Express application factory.
 *
 * Design decisions:
 * - Exports createApp() rather than a singleton `app`. Tests call
 *   createApp() to get a fresh instance with no shared state between
 *   test files. The server entry point (server.ts) calls it once.
 * - app.listen() is NOT called here. Separation of construction from
 *   binding means tests never open a real TCP port.
 * - An optional `extraRouters` parameter lets tests inject routes before
 *   the 404 and error handlers are registered, making error-handler tests
 *   possible without monkey-patching the app after construction.
 * - Middleware order matters in Express. The chain below is deliberate:
 *     1. httpLogger  — log every request (including 404s and errors)
 *     2. json parser — parse bodies before routes read them
 *     3. Routes      — business logic
 *     4. extraRouters — optional test-only routes (empty in production)
 *     5. 404 handler — catch requests that matched no route
 *     6. Error handler — final catch-all; must have (err,req,res,next) signature
 */
import express, { NextFunction, Request, Response, Router } from 'express';
import { httpLogger } from '../lib/logger';
import { env } from '../config/env';
import { checkDatabaseConnection } from '../lib/db';
import { checkRedisConnection } from '../lib/redis';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shape of every JSON error response the API sends.
 * Consistent structure makes client error handling predictable.
 */
interface ErrorResponse {
  status: 'error';
  message: string;
  /** Only present in development — never in production */
  stack?: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * @param extraRouters - Optional Express routers to mount before the 404 handler.
 *   Used in tests to inject deliberate error routes. Never used in production.
 */
export function createApp(extraRouters: Router[] = []): express.Application {
  const app = express();

  // ── Global middleware ────────────────────────────────────────────────────

  // 1. HTTP request/response logging with request-id stamping
  app.use(httpLogger);

  // 2. Parse JSON request bodies (limit keeps memory usage bounded)
  app.use(express.json({ limit: '1mb' }));

  // ── Routes ───────────────────────────────────────────────────────────────

  /**
   * GET /health
   * Pure liveness check: confirms the process is alive and the HTTP layer is responsive.
   * Does NOT check dependencies (used by orchestrators for process restarts).
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  /**
   * GET /ready
   * Dependency readiness check: queries PostgreSQL and pings Redis.
   * Returns HTTP 200 when both are up; returns HTTP 503 with per-dependency detail when not.
   */
  app.get('/ready', async (_req: Request, res: Response) => {
    const [dbStatus, redisStatus] = await Promise.all([
      checkDatabaseConnection(),
      checkRedisConnection(),
    ]);

    const isReady = dbStatus.ok && redisStatus.ok;

    const response = {
      status: isReady ? 'ready' : 'not_ready',
      dependencies: {
        postgres: {
          status: dbStatus.ok ? 'up' : 'down',
          ...(dbStatus.latencyMs !== undefined && { latencyMs: dbStatus.latencyMs }),
          ...(dbStatus.error !== undefined && { error: dbStatus.error }),
        },
        redis: {
          status: redisStatus.ok ? 'up' : 'down',
          ...(redisStatus.latencyMs !== undefined && { latencyMs: redisStatus.latencyMs }),
          ...(redisStatus.error !== undefined && { error: redisStatus.error }),
        },
      },
    };

    res.status(isReady ? 200 : 503).json(response);
  });

  // 3. Mount any extra routers (test-only; empty array in production)
  for (const router of extraRouters) {
    app.use(router);
  }

  // ── 404 handler ──────────────────────────────────────────────────────────

  // Runs when no route above matched. Must be registered AFTER all routes.
  app.use((_req: Request, res: Response) => {
    const body: ErrorResponse = { status: 'error', message: 'Not Found' };
    res.status(404).json(body);
  });

  // ── Central error handler ────────────────────────────────────────────────

  // Express identifies an error handler by its four-parameter signature.
  // The _next parameter MUST be declared even if unused — Express uses arity
  // (number of parameters) to identify error handlers vs regular middleware.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Normalise to an Error object so we can read .message and .stack safely
    const error = err instanceof Error ? err : new Error(String(err));

    // Log the full error (including stack) server-side via the request logger.
    // res.log is the per-request pino child created by pinoHttp.
    res.log.error({ err: error }, 'Unhandled error');

    // Extract a numeric statusCode if the error carries one (e.g., from
    // a future HttpError class). Casting through unknown is the safe pattern
    // recommended by @typescript-eslint when accessing dynamic properties.
    const errorRecord = error as unknown as Record<string, unknown>;
    const rawCode = 'statusCode' in error ? errorRecord['statusCode'] : undefined;
    const statusCode = typeof rawCode === 'number' ? rawCode : 500;

    const body: ErrorResponse = {
      status: 'error',
      message: statusCode === 500 ? 'Internal Server Error' : error.message,
      // Only expose stack in development — never leak internals in production
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    };

    res.status(statusCode).json(body);
  });

  return app;
}
