/**
 * src/modules/reports/reports.repository.ts
 *
 * Data Access Layer for reports table.
 *
 * Design decisions:
 * - All queries use strictly parameterized values ($1, $2, ...) to prevent SQL injection.
 * - All status transitions use guarded UPDATEs (e.g., WHERE id = $1 AND status = 'PROCESSING')
 *   so that concurrent worker processes or out-of-order execution cannot corrupt state.
 * - updated_at is explicitly set to NOW() on every mutation.
 * - Accepts an optional Pool or PoolClient so callers can run queries in a transaction
 *   or against an alternate database (e.g., the dedicated test database).
 */
import { Pool, PoolClient } from 'pg';
import { pool as defaultPool } from '../../lib/db';
import { CreateReportInput, Report, REPORT_STATUS, ReportStatus } from './report.types';

type Queryable = Pool | PoolClient;

interface ReportRow {
  id: string;
  status: string;
  params: Record<string, unknown>;
  attempts: number;
  file_path: string | null;
  error_trace: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function mapRowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    status: row.status as ReportStatus,
    params: row.params,
    attempts: row.attempts,
    file_path: row.file_path,
    error_trace: row.error_trace,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

export class ReportsRepository {
  private readonly db: Queryable;

  constructor(db: Queryable = defaultPool) {
    this.db = db;
  }

  /**
   * Insert a new report in PENDING status.
   */
  async create(input: CreateReportInput): Promise<Report> {
    const query = `
      INSERT INTO reports (params)
      VALUES ($1::jsonb)
      RETURNING id, status, params, attempts, file_path, error_trace,
                created_at, updated_at, started_at, completed_at;
    `;
    const params = [JSON.stringify(input.params)];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    if (!row) {
      throw new Error('Failed to create report: no row returned from INSERT');
    }

    return mapRowToReport(row);
  }

  /**
   * Find a report by its UUID. Returns null if not found.
   */
  async findById(id: string): Promise<Report | null> {
    const query = `
      SELECT id, status, params, attempts, file_path, error_trace,
             created_at, updated_at, started_at, completed_at
      FROM reports
      WHERE id = $1;
    `;
    const params = [id];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    return row ? mapRowToReport(row) : null;
  }

  /**
   * Guarded update: Transitions a report from PENDING or FAILED to PROCESSING.
   * Increments the attempts counter and records started_at.
   *
   * Returns updated report, or null if report does not exist or status guard failed.
   */
  async markProcessing(id: string): Promise<Report | null> {
    const query = `
      UPDATE reports
      SET status = $1,
          attempts = attempts + 1,
          started_at = NOW(),
          updated_at = NOW()
      WHERE id = $2 AND status IN ($3, $4)
      RETURNING id, status, params, attempts, file_path, error_trace,
                created_at, updated_at, started_at, completed_at;
    `;
    const params = [REPORT_STATUS.PROCESSING, id, REPORT_STATUS.PENDING, REPORT_STATUS.FAILED];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    return row ? mapRowToReport(row) : null;
  }

  /**
   * Guarded update: Transitions a report from PROCESSING to COMPLETED.
   * Sets file_path and completed_at.
   *
   * Returns updated report, or null if report does not exist or status was not PROCESSING.
   */
  async markCompleted(id: string, filePath: string): Promise<Report | null> {
    const query = `
      UPDATE reports
      SET status = $1,
          file_path = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $3 AND status = $4
      RETURNING id, status, params, attempts, file_path, error_trace,
                created_at, updated_at, started_at, completed_at;
    `;
    const params = [REPORT_STATUS.COMPLETED, filePath, id, REPORT_STATUS.PROCESSING];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    return row ? mapRowToReport(row) : null;
  }

  /**
   * Guarded update: Transitions a report from PROCESSING to FAILED.
   * Sets error_trace.
   *
   * Returns updated report, or null if report does not exist or status was not PROCESSING.
   */
  async markFailed(id: string, errorTrace: string): Promise<Report | null> {
    const query = `
      UPDATE reports
      SET status = $1,
          error_trace = $2,
          updated_at = NOW()
      WHERE id = $3 AND status = $4
      RETURNING id, status, params, attempts, file_path, error_trace,
                created_at, updated_at, started_at, completed_at;
    `;
    const params = [REPORT_STATUS.FAILED, errorTrace, id, REPORT_STATUS.PROCESSING];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    return row ? mapRowToReport(row) : null;
  }

  /**
   * Guarded update: Transitions a report to PERMANENTLY_FAILED from PENDING, PROCESSING, or FAILED.
   * Sets error_trace and completed_at.
   *
   * Returns updated report, or null if report does not exist or was already in a terminal state.
   */
  async markPermanentlyFailed(id: string, errorTrace: string): Promise<Report | null> {
    const query = `
      UPDATE reports
      SET status = $1,
          error_trace = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $3 AND status IN ($4, $5, $6)
      RETURNING id, status, params, attempts, file_path, error_trace,
                created_at, updated_at, started_at, completed_at;
    `;
    const params = [
      REPORT_STATUS.PERMANENTLY_FAILED,
      errorTrace,
      id,
      REPORT_STATUS.PENDING,
      REPORT_STATUS.PROCESSING,
      REPORT_STATUS.FAILED,
    ];

    const result = await this.db.query<ReportRow>(query, params);
    const row = result.rows[0];

    return row ? mapRowToReport(row) : null;
  }
}

export const reportsRepository = new ReportsRepository();
