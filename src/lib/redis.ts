/**
 * src/lib/redis.ts
 *
 * Redis client management and BullMQ connection factory using `ioredis`.
 *
 * Design decisions:
 * - BullMQ requires `maxRetriesPerRequest: null` for its Redis connections
 *   because workers use blocking commands (e.g., BRPOPLPUSH, BLMOVE) and BullMQ
 *   handles retry logic internally. We expose `createBullMQRedisClient()` to enforce this.
 * - A general-purpose `redisClient` instance is exported for lightweight application
 *   usage (such as health/readiness checks or caching).
 * - An error listener is attached to `redisClient` immediately to prevent unhandled
 *   EventEmitter error exceptions from crashing the process when Redis is down or reconnecting.
 * - `checkRedisConnection()` issues a fast `PING` command wrapped in a timeout promise (default 2s).
 * - `closeRedisClients()` provides graceful connection teardown during server shutdown.
 */
import Redis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Factory for creating Redis connections specifically configured for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` on all connections (client, subscriber, bclient).
 */
export function createBullMQRedisClient(customOptions: RedisOptions = {}): Redis {
  // exactOptionalPropertyTypes in TypeScript strict mode conflicts with ioredis's
  // internal replyMapping type signature. Using a typed constructor avoids this mismatch cleanly.
  const RedisConstructor = Redis as unknown as new (url: string, options?: unknown) => Redis;

  const client = new RedisConstructor(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...customOptions,
  });

  client.on('error', (err) => {
    logger.error({ err }, 'BullMQ Redis connection error');
  });

  return client;
}

/**
 * General application Redis client for caching, ping, and non-blocking operations.
 */
export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number): number => {
    // Exponential backoff capped at 2 seconds
    return Math.min(times * 100, 2000);
  },
  // Use lazyConnect so client does not spam connection attempts before commands are issued
  lazyConnect: true,
});

redisClient.on('error', (err) => {
  logger.error({ err }, 'Application Redis client error');
});

export interface RedisHealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Execute a fast PING to verify Redis connectivity.
 *
 * @param timeoutMs - Maximum milliseconds to wait for a PONG response before timing out.
 */
export async function checkRedisConnection(timeoutMs = 2000): Promise<RedisHealthStatus> {
  const start = Date.now();

  try {
    const pingPromise = redisClient.ping();

    const timeoutPromise = new Promise<string>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Redis healthcheck timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
    });

    const reply = await Promise.race([pingPromise, timeoutPromise]);

    if (reply !== 'PONG') {
      return {
        ok: false,
        error: `Unexpected reply from Redis: "${reply}"`,
      };
    }

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
 * Gracefully quit the general Redis client.
 */
export async function closeRedisClients(): Promise<void> {
  try {
    if (redisClient.status === 'ready' || redisClient.status === 'connect') {
      await redisClient.quit();
    } else {
      redisClient.disconnect();
    }
    logger.info('Redis client connection closed');
  } catch (err) {
    try {
      redisClient.disconnect();
    } catch {
      // Disconnect attempt fallback
    }
    logger.error({ err }, 'Error closing Redis client connection');
  }
}
