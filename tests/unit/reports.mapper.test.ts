/**
 * tests/unit/reports.mapper.test.ts
 *
 * Unit tests for mapping database Report entities to public ReportStatusResponse objects.
 */
import { describe, it, expect } from 'vitest';
import {
  mapReportToStatusResponse,
  SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE,
} from '../../src/modules/reports/reports.mapper';
import { Report, REPORT_STATUS } from '../../src/modules/reports/report.types';

describe('mapReportToStatusResponse', () => {
  const baseReport: Report = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    status: REPORT_STATUS.PENDING,
    params: { reportType: 'invoice', format: 'pdf', rowCount: 10 },
    attempts: 0,
    file_path: null,
    error_trace: null,
    created_at: new Date('2026-09-30T10:00:00.000Z'),
    updated_at: new Date('2026-09-30T10:00:01.000Z'),
    started_at: null,
    completed_at: null,
  };

  it('maps PENDING report with null downloadUrl and null errorMessage', () => {
    const report: Report = { ...baseReport, status: REPORT_STATUS.PENDING };
    const response = mapReportToStatusResponse(report);

    expect(response).toEqual({
      jobId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      status: REPORT_STATUS.PENDING,
      attempts: 0,
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:01.000Z',
      downloadUrl: null,
      errorMessage: null,
    });
  });

  it('maps PROCESSING report with null downloadUrl and null errorMessage', () => {
    const report: Report = {
      ...baseReport,
      status: REPORT_STATUS.PROCESSING,
      attempts: 1,
      started_at: new Date('2026-09-30T10:00:05.000Z'),
    };
    const response = mapReportToStatusResponse(report);

    expect(response.status).toBe(REPORT_STATUS.PROCESSING);
    expect(response.attempts).toBe(1);
    expect(response.downloadUrl).toBeNull();
    expect(response.errorMessage).toBeNull();
  });

  it('maps FAILED report with null downloadUrl and null errorMessage (does not leak error_trace)', () => {
    const report: Report = {
      ...baseReport,
      status: REPORT_STATUS.FAILED,
      attempts: 2,
      error_trace: 'Error: Database lock acquisition timeout\n  at db.ts:42\n  at async worker()',
    };
    const response = mapReportToStatusResponse(report);

    expect(response.status).toBe(REPORT_STATUS.FAILED);
    expect(response.attempts).toBe(2);
    expect(response.downloadUrl).toBeNull();
    expect(response.errorMessage).toBeNull();

    // Verify raw error_trace did not leak into any field
    const responseStr = JSON.stringify(response);
    expect(responseStr).not.toContain('Database lock acquisition timeout');
    expect(responseStr).not.toContain('db.ts:42');
  });

  it('maps COMPLETED report with valid downloadUrl and null errorMessage', () => {
    const report: Report = {
      ...baseReport,
      status: REPORT_STATUS.COMPLETED,
      attempts: 1,
      file_path: '/tmp/reports/f47ac10b-58cc-4372-a567-0e02b2c3d479.pdf',
      completed_at: new Date('2026-09-30T10:00:15.000Z'),
    };
    const response = mapReportToStatusResponse(report);

    expect(response.status).toBe(REPORT_STATUS.COMPLETED);
    expect(response.downloadUrl).toBe('/api/reports/f47ac10b-58cc-4372-a567-0e02b2c3d479/download');
    expect(response.errorMessage).toBeNull();

    // Verify internal file_path does not leak
    expect(JSON.stringify(response)).not.toContain('/tmp/reports');
  });

  it('maps PERMANENTLY_FAILED report with null downloadUrl and safe errorMessage (no raw trace)', () => {
    const report: Report = {
      ...baseReport,
      status: REPORT_STATUS.PERMANENTLY_FAILED,
      attempts: 3,
      error_trace:
        'FatalError: Out of memory in worker thread\n  at v8.cc:105\n  password=secret_db_pass',
      completed_at: new Date('2026-09-30T10:01:00.000Z'),
    };
    const response = mapReportToStatusResponse(report);

    expect(response.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);
    expect(response.attempts).toBe(3);
    expect(response.downloadUrl).toBeNull();
    expect(response.errorMessage).toBe(SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE);

    // Verify raw error_trace or stack trace never leaks
    const responseStr = JSON.stringify(response);
    expect(responseStr).not.toContain('FatalError');
    expect(responseStr).not.toContain('secret_db_pass');
    expect(responseStr).not.toContain('v8.cc:105');
  });
});
