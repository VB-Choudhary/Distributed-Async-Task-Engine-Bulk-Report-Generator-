/**
 * src/modules/reports/report.types.ts
 *
 * Domain types and models for the reports module.
 */

export const REPORT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PERMANENTLY_FAILED: 'PERMANENTLY_FAILED',
} as const;

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];

export interface Report {
  id: string;
  status: ReportStatus;
  params: Record<string, unknown>;
  attempts: number;
  file_path: string | null;
  error_trace: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface CreateReportInput {
  params: Record<string, unknown>;
}
