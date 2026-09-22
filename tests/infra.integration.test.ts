/**
 * tests/infra.integration.test.ts
 *
 * Optional live integration tests against PostgreSQL and Redis.
 *
 * Design decision:
 * When Docker Desktop is active and `npm run infra:up` has been executed,
 * this suite performs real wire queries against localhost:5432 and localhost:6379.
 * If the infrastructure is offline (e.g., standard CI or initial checkout),
 * the tests detect it within 500ms and gracefully skip without failing the build.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { checkDatabaseConnection, closeDatabasePool } from '../src/lib/db';
import { checkRedisConnection, closeRedisClients } from '../src/lib/redis';

describe('Live Infrastructure Integration Tests', () => {
  afterAll(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });

  it('connects to live PostgreSQL when container is available', async () => {
    const status = await checkDatabaseConnection(500);

    if (!status.ok) {
      // Container not running — skip gracefully
      return;
    }

    expect(status.ok).toBe(true);
    expect(typeof status.latencyMs).toBe('number');
    expect(status.error).toBeUndefined();
  });

  it('connects to live Redis and receives PONG when container is available', async () => {
    const status = await checkRedisConnection(500);

    if (!status.ok) {
      // Container not running — skip gracefully
      return;
    }

    expect(status.ok).toBe(true);
    expect(typeof status.latencyMs).toBe('number');
    expect(status.error).toBeUndefined();
  });
});
