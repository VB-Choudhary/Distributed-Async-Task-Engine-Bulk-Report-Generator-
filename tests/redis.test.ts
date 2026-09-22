/**
 * tests/redis.test.ts
 *
 * Unit tests for Redis factory and BullMQ configuration.
 */
import { describe, it, expect, vi } from 'vitest';
import Redis from 'ioredis';
import { createBullMQRedisClient } from '../src/lib/redis';

// Mock ioredis so this test runs purely in-memory without network sockets
vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(function (
    this: {
      url?: string;
      options?: unknown;
      on: ReturnType<typeof vi.fn>;
      ping: ReturnType<typeof vi.fn>;
      quit: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    },
    url: string,
    options: unknown,
  ) {
    this.url = url;
    this.options = options;
    this.on = vi.fn();
    this.ping = vi.fn().mockResolvedValue('PONG');
    this.quit = vi.fn().mockResolvedValue('OK');
    this.disconnect = vi.fn();
    return this;
  });

  return {
    default: MockRedis,
  };
});

describe('createBullMQRedisClient', () => {
  it('creates an ioredis instance with maxRetriesPerRequest: null required by BullMQ', () => {
    const client = createBullMQRedisClient();

    expect(client).toBeDefined();
    // BullMQ explicitly forbids numbers for maxRetriesPerRequest to prevent blocking-command aborts
    expect(Redis).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }),
    );
  });

  it('allows overriding custom options while preserving BullMQ compatibility', () => {
    createBullMQRedisClient({ connectionName: 'custom-bullmq-worker' });

    expect(Redis).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxRetriesPerRequest: null,
        connectionName: 'custom-bullmq-worker',
      }),
    );
  });
});
