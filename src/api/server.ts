/**
 * src/api/server.ts
 *
 * Process entry point — the only file that calls app.listen().
 *
 * Design decisions:
 * - Imports env first. If env validation fails, the error is thrown here
 *   before any network socket is opened, and the process exits non-zero.
 * - The SIGINT handler (Ctrl+C) and SIGTERM handler (Docker/systemd stop)
 *   both call the same graceful shutdown function for DRY consistency.
 * - server.close() stops accepting new connections but waits for in-flight
 *   requests to finish. We give them 10 s before forcing exit.
 * - process.exitCode is set before calling server.close() so that if the
 *   close callback never fires, the forced exit still exits with code 0.
 */
// Load .env file into process.env BEFORE env.ts reads process.env.
// dotenv.config() is a no-op if .env doesn't exist (safe in production).
import 'dotenv/config';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { closeDatabasePool } from '../lib/db';
import { closeRedisClients } from '../lib/redis';
import { createApp } from './app';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, logLevel: env.LOG_LEVEL }, 'Server started');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutdown signal received — closing server');

  // Mark intended exit code before the async shutdown starts
  process.exitCode = 0;

  const timer = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Don't let this timer prevent the event loop from draining naturally
  timer.unref();

  server.close((err) => {
    if (err != null) {
      logger.error({ err }, 'Error during server close');
      process.exitCode = 1;
    } else {
      logger.info('Server closed cleanly');
    }

    // Drain connection pool and disconnect redis clients
    void Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Catch unexpected errors that escaped all error handlers
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exitCode = 1;
  server.close(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
  process.exitCode = 1;
  server.close(() => process.exit(1));
});
