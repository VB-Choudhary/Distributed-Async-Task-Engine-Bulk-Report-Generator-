/**
 * src/modules/reports/reports.service.ts
 *
 * Application service coordinating report creation and queue dispatch.
 *
 * Design decisions:
 * - Insert First, Enqueue Second: We persist the report row to PostgreSQL first in PENDING status.
 *   This ensures a durable system of record before distributing work.
 * - Failure Compensation: If queue.add() fails (e.g., Redis is down or unreachable),
 *   we immediately mark the report row as PERMANENTLY_FAILED with the failure stack trace
 *   and throw ServiceUnavailableError. This guarantees database consistency and avoids zombie PENDING rows.
 * - Minimal Queue Payload: We enqueue `{ reportId }` only, with `jobId = reportId`.
 *   The worker will fetch report parameters directly from PostgreSQL, keeping PostgreSQL
 *   as the single source of truth and minimizing Redis memory footprint.
 * - Dependency Injection: Accepts optional repository and queue instances for unit testing.
 */
import { Queue } from 'bullmq';
import { reportQueue } from '../../queue/queues';
import { reportsRepository, ReportsRepository } from './reports.repository';
import {
  GenerateReportJobPayload,
  GenerateReportResponse,
  ReportStatusResponse,
} from './report.types';
import { GenerateReportInput } from './reports.schema';
import { mapReportToStatusResponse } from './reports.mapper';
import { logger } from '../../lib/logger';

export class ServiceUnavailableError extends Error {
  public readonly statusCode = 503;

  constructor(message = 'Service temporarily unavailable. Failed to enqueue report job.') {
    super(message);
    this.name = 'ServiceUnavailableError';
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

export class ReportsService {
  private readonly repository: ReportsRepository;
  private readonly queue: Queue<GenerateReportJobPayload>;

  constructor(
    repository: ReportsRepository = reportsRepository,
    queue: Queue<GenerateReportJobPayload> = reportQueue,
  ) {
    this.repository = repository;
    this.queue = queue;
  }

  /**
   * Orchestrates report persistence and background job enqueueing.
   */
  async generateReport(input: GenerateReportInput): Promise<GenerateReportResponse> {
    const reportId = crypto.randomUUID();

    // 1. Persist the report record in PENDING status
    const report = await this.repository.create({
      id: reportId,
      params: input,
    });

    // 2. Dispatch the job to the BullMQ queue
    try {
      await this.queue.add(
        'generate-report',
        { reportId },
        {
          jobId: reportId,
        },
      );
    } catch (error) {
      const errorTrace = error instanceof Error ? (error.stack ?? error.message) : String(error);

      logger.error(
        { err: error, reportId },
        'Failed to enqueue report job to Redis queue; marking report PERMANENTLY_FAILED',
      );

      // Compensate: mark the record PERMANENTLY_FAILED so it does not remain stuck in PENDING
      await this.repository.markPermanentlyFailed(reportId, errorTrace);

      throw new ServiceUnavailableError(
        'Service temporarily unavailable. Failed to enqueue report job.',
      );
    }

    return {
      jobId: report.id,
      status: report.status,
      statusUrl: `/api/reports/${report.id}`,
    };
  }

  /**
   * Retrieves the current status of a report by its UUID and maps it to the public contract.
   * Returns null if no record exists with the provided ID.
   */
  async getReportStatus(jobId: string): Promise<ReportStatusResponse | null> {
    const report = await this.repository.findById(jobId);
    if (!report) {
      return null;
    }
    return mapReportToStatusResponse(report);
  }
}

export const reportsService = new ReportsService();
