/**
 * tests/ready.test.ts
 *
 * Unit & integration tests for GET /ready.
 *
 * Uses mocked database and redis healthcheck functions to verify:
 * - 200 OK when both PostgreSQL and Redis are healthy.
 * - 503 Service Unavailable when PostgreSQL is down (naming postgres in failure details).
 * - 503 Service Unavailable when Redis is down (naming redis in failure details).
 * - 503 Service Unavailable when both are down.
 * - Proper JSON structure and x-request-id tracing header.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/api/app';
import * as dbModule from '../src/lib/db';
import * as redisModule from '../src/lib/redis';

vi.mock('../src/lib/db', () => ({
  checkDatabaseConnection: vi.fn(),
  closeDatabasePool: vi.fn(),
  pool: { end: vi.fn(), on: vi.fn() },
}));

vi.mock('../src/lib/redis', () => ({
  checkRedisConnection: vi.fn(),
  closeRedisClients: vi.fn(),
  createBullMQRedisClient: vi.fn(),
  redisClient: { ping: vi.fn(), quit: vi.fn(), on: vi.fn() },
}));

interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

interface ReadinessResponseBody {
  status: 'ready' | 'not_ready';
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
  };
}

let app: express.Application;

beforeEach(() => {
  vi.clearAllMocks();
  app = createApp();
});

describe('GET /ready', () => {
  it('returns 200 with status "ready" when both dependencies are up', async () => {
    vi.mocked(dbModule.checkDatabaseConnection).mockResolvedValue({
      ok: true,
      latencyMs: 3,
    });
    vi.mocked(redisModule.checkRedisConnection).mockResolvedValue({
      ok: true,
      latencyMs: 1,
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    const body = res.body as ReadinessResponseBody;
    expect(body.status).toBe('ready');
    expect(body.dependencies.postgres.status).toBe('up');
    expect(body.dependencies.postgres.latencyMs).toBe(3);
    expect(body.dependencies.redis.status).toBe('up');
    expect(body.dependencies.redis.latencyMs).toBe(1);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 503 with status "not_ready" when PostgreSQL is down', async () => {
    vi.mocked(dbModule.checkDatabaseConnection).mockResolvedValue({
      ok: false,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    vi.mocked(redisModule.checkRedisConnection).mockResolvedValue({
      ok: true,
      latencyMs: 2,
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    const body = res.body as ReadinessResponseBody;
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.postgres.status).toBe('down');
    expect(body.dependencies.postgres.error).toContain('ECONNREFUSED');
    expect(body.dependencies.redis.status).toBe('up');
  });

  it('returns 503 with status "not_ready" when Redis is down', async () => {
    vi.mocked(dbModule.checkDatabaseConnection).mockResolvedValue({
      ok: true,
      latencyMs: 4,
    });
    vi.mocked(redisModule.checkRedisConnection).mockResolvedValue({
      ok: false,
      error: 'Redis healthcheck timed out after 2000ms',
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    const body = res.body as ReadinessResponseBody;
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.postgres.status).toBe('up');
    expect(body.dependencies.redis.status).toBe('down');
    expect(body.dependencies.redis.error).toContain('timed out');
  });

  it('returns 503 with status "not_ready" when both dependencies are down', async () => {
    vi.mocked(dbModule.checkDatabaseConnection).mockResolvedValue({
      ok: false,
      error: 'PostgreSQL connection failed',
    });
    vi.mocked(redisModule.checkRedisConnection).mockResolvedValue({
      ok: false,
      error: 'Redis connection failed',
    });

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    const body = res.body as ReadinessResponseBody;
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.postgres.status).toBe('down');
    expect(body.dependencies.redis.status).toBe('down');
  });

  it('verifies /health remains unaffected and returns 200 regardless of dependencies', async () => {
    // Both dependencies are simulated as failing
    vi.mocked(dbModule.checkDatabaseConnection).mockResolvedValue({
      ok: false,
      error: 'down',
    });
    vi.mocked(redisModule.checkRedisConnection).mockResolvedValue({
      ok: false,
      error: 'down',
    });

    const res = await request(app).get('/health');

    // /health is pure liveness, not readiness
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
