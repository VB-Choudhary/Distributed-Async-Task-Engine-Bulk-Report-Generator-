/**
 * src/lib/logger.ts
 *
 * Central pino logger + request-id middleware.
 *
 * Design decisions:
 * - One shared logger instance is exported. All other modules import this
 *   and call logger.child({ module: 'name' }) so log lines always carry
 *   their origin context.
 * - pinoHttp is a thin wrapper that creates a child logger per request,
 *   automatically logs req/res pairs, and stamps every log line inside a
 *   request with a `requestId` field — invaluable for tracing failures.
 * - We use crypto.randomUUID() (built into Node ≥ 14.17) so there's no
 *   extra package to install.
 * - The requestId is stored on `req.requestId` (see src/types/express.d.ts)
 *   so route handlers and other middleware can include it in their own logs.
 */
import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from '../config/env';

// ── Shared logger instance ────────────────────────────────────────────────────
export const logger = pino({
  level: env.LOG_LEVEL,

  // In development, pretty-print with colours; in production, emit newline-
  // delimited JSON which log aggregators (Datadog, CloudWatch, etc.) can parse.
  // We use a conditional spread rather than `transport: X | undefined` because
  // exactOptionalPropertyTypes disallows explicitly setting a property to undefined.
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

// ── Request-id middleware + HTTP logging ──────────────────────────────────────
export const httpLogger = pinoHttp({
  logger,

  // Generate a unique ID for every incoming request. This ID is attached to
  // every log line emitted during that request's lifecycle.
  genReqId: (req, res) => {
    // Honour an upstream proxy's trace header when present (e.g., API gateway)
    const existingId = req.headers['x-request-id'] ?? req.headers['x-correlation-id'];
    const id = typeof existingId === 'string' ? existingId : crypto.randomUUID();

    // Store on the response so clients can correlate their error reports
    res.setHeader('x-request-id', id);
    return id;
  },

  // Keep noise down in tests; still log errors
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },

  // Redact sensitive headers before they reach the log stream
  redact: ['req.headers.authorization', 'req.headers.cookie'],

  // Map HTTP status codes to log levels
  customLogLevel: (_req, res, err) => {
    if (err != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
