/**
 * src/modules/reports/reports.mapper.ts
 *
 * Data transformation layer for public reports API responses.
 *
 * Design decisions:
 * - Separates internal database model (`Report`) from public API response (`ReportStatusResponse`).
 * - Security: Internal database columns like `error_trace` and `file_path` are never exposed.
 * - `downloadUrl`: Provided only when status is COMPLETED; null for all other statuses.
 * - `errorMessage`: Provides a safe, sanitized, human-readable string only when status
 *   is PERMANENTLY_FAILED; null for all other statuses.
 */
import { Report, REPORT_STATUS, ReportStatusResponse } from './report.types';

export const SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE =
  'Report generation failed after multiple attempts.';

/**
 * Maps an internal database Report entity to the public ReportStatusResponse contract.
 */
export function mapReportToStatusResponse(report: Report): ReportStatusResponse {
  const downloadUrl =
    report.status === REPORT_STATUS.COMPLETED ? `/api/reports/${report.id}/download` : null;

  const errorMessage =
    report.status === REPORT_STATUS.PERMANENTLY_FAILED
      ? SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE
      : null;

  return {
    jobId: report.id,
    status: report.status,
    attempts: report.attempts,
    createdAt: report.created_at.toISOString(),
    updatedAt: report.updated_at.toISOString(),
    downloadUrl,
    errorMessage,
  };
}
