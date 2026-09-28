/**
 * src/queue/queues.ts
 *
 * BullMQ Queue definitions and connection management.
 *
 * Design decisions:
 * - Uses `createBullMQRedisClient()` to ensure `maxRetriesPerRequest: null`
 *   as strictly required by BullMQ.
 * - `defaultJobOptions` is configured with job retention limits:
 *   `removeOnComplete: { count: 1000 }` and `removeOnFail: { count: 5000 }`
 *   to prevent unbounded Redis memory growth.
 * - No retry options are configured in this phase (deliberately left for worker/queue config in future phase).
 * - `closeReportQueue()` provides a graceful shutdown hook.
 */
import { Queue } from 'bullmq';
import { createBullMQRedisClient } from '../lib/redis';
import { GenerateReportJobPayload } from '../modules/reports/report.types';
import { logger } from '../lib/logger';

export const REPORT_QUEUE_NAME = 'report-generation';

// Dedicated Redis connection for the producer queue
export const reportQueueConnection = createBullMQRedisClient({
  connectionName: 'bullmq-report-queue-connection',
});

export const reportQueue = new Queue<GenerateReportJobPayload>(REPORT_QUEUE_NAME, {
  connection: reportQueueConnection,
  defaultJobOptions: {
    removeOnComplete: {
      count: 1000,
    },
    removeOnFail: {
      count: 5000,
    },
  },
});

reportQueue.on('error', (err) => {
  logger.error({ err }, 'Report BullMQ queue error');
});

/**
 * Gracefully close the BullMQ Queue and its dedicated Redis connection.
 */
export async function closeReportQueue(): Promise<void> {
  try {
    await reportQueue.close();
    await reportQueueConnection.quit();
    logger.info('Report BullMQ queue closed cleanly');
  } catch (err) {
    try {
      reportQueueConnection.disconnect();
    } catch {
      // Ignore disconnect fallback errors
    }
    logger.error({ err }, 'Error closing Report BullMQ queue');
  }
}
