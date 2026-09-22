/**
 * src/lib/db.ts
 *
 * PostgreSQL connection pooling and healthcheck management using `pg`.
 *
 * Design decisions:
 * - A single `pg.Pool` instance manages connections across the application.
 *   Pool limits prevent database connection exhaustion under load.
 * - `pool.on('error')` captures idle client errors that occur outside active queries,
 *   preventing unexpected process crashes.
 * - `checkDatabaseConnection()` runs a lightweight query (`SELECT 1`) bounded by a
 *   timeout (default 2s), preventing readiness checks from hanging on network partitions.
 * - `closeDatabasePool()` provides graceful teardown of connection resources during
 *   server shutdown.
 */
import { Pool, PoolConfig } from 'pg';
import { env } from '../config/env';
import { logger } from './logger';

const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

export const pool = new Pool(poolConfig);

// Catch unexpected errors on idle database clients
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export interface DatabaseHealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Execute a fast ping query to verify database connectivity.
 *
 * @param timeoutMs - Maximum milliseconds to wait for a response before timing out.
 */
export async function checkDatabaseConnection(timeoutMs = 2000): Promise<DatabaseHealthStatus> {
  const start = Date.now();

  try {
    const queryPromise = pool.query('SELECT 1 AS alive');

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`PostgreSQL healthcheck timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
    });

    await Promise.race([queryPromise, timeoutPromise]);

    return {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
    };
  }
}

/**
 * Gracefully drain and close the PostgreSQL connection pool.
 */
export async function closeDatabasePool(): Promise<void> {
  try {
    await pool.end();
    logger.info('PostgreSQL connection pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing PostgreSQL connection pool');
  }
}
