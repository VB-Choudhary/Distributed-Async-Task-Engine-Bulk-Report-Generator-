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

/**
 * Construct the test database connection string by replacing the database name with reports_test.
 */
export function getTestDatabaseUrl(): string {
  const url = new URL(env.DATABASE_URL);
  url.pathname = '/reports_test';
  return url.toString();
}

/**
 * Factory function to create a new Pool with standardized settings.
 *
 * @param connectionString - Optional connection URL; defaults to env.DATABASE_URL.
 */
export function createDatabasePool(connectionString?: string): Pool {
  const config: PoolConfig = {
    connectionString: connectionString ?? env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  const newPool = new Pool(config);

  newPool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
  });

  return newPool;
}

export const pool = createDatabasePool(env.DATABASE_URL);

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
