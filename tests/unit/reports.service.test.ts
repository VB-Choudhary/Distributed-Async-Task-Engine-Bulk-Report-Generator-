/**
 * tests/unit/reports.service.test.ts
 *
 * Unit tests for ReportsService business logic, enqueueing, compensation, and status retrieval.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Queue } from 'bullmq';
import { ReportsService, ServiceUnavailableError } from '../../src/modules/reports/reports.service';
import { ReportsRepository } from '../../src/modules/reports/reports.repository';
import {
  GenerateReportJobPayload,
  REPORT_STATUS,
  Report,
} from '../../src/modules/reports/report.types';

describe('ReportsService', () => {
  let createMock: ReturnType<typeof vi.fn>;
  let findByIdMock: ReturnType<typeof vi.fn>;
  let markPermanentlyFailedMock: ReturnType<typeof vi.fn>;
  let queueAddMock: ReturnType<typeof vi.fn>;
  let service: ReportsService;

  beforeEach(() => {
    createMock = vi.fn();
    findByIdMock = vi.fn();
    markPermanentlyFailedMock = vi.fn();
    queueAddMock = vi.fn();

    const mockRepo = {
      create: createMock,
      findById: findByIdMock,
      markPermanentlyFailed: markPermanentlyFailedMock,
    } as unknown as ReportsRepository;

    const mockQueue = {
      add: queueAddMock,
    } as unknown as Queue<GenerateReportJobPayload>;

    service = new ReportsService(mockRepo, mockQueue);
  });

  describe('generateReport - Success flow', () => {
    it('creates report record and enqueues background job with matching jobId', async () => {
      const input = {
        reportType: 'invoice' as const,
        format: 'pdf' as const,
        rowCount: 100,
        title: 'Monthly Invoices',
      };

      const mockCreatedRecord: Report = {
        id: 'mock-uuid-1234',
        status: REPORT_STATUS.PENDING,
        params: input,
        attempts: 0,
        file_path: null,
        error_trace: null,
        created_at: new Date(),
        updated_at: new Date(),
        started_at: null,
        completed_at: null,
      };

      createMock.mockResolvedValue(mockCreatedRecord);
      queueAddMock.mockResolvedValue({ id: 'mock-uuid-1234' });

      const response = await service.generateReport(input);

      // Verify repository was called with generated id and input
      expect(createMock).toHaveBeenCalledTimes(1);
      const repoCallArg = createMock.mock.calls[0]?.[0] as {
        id?: string;
        params: typeof input;
      };
      expect(repoCallArg).toBeDefined();
      expect(repoCallArg.params).toEqual(input);
      expect(typeof repoCallArg.id).toBe('string');

      // Verify queue.add was called with reportId and options
      expect(queueAddMock).toHaveBeenCalledTimes(1);
      expect(queueAddMock).toHaveBeenCalledWith(
        'generate-report',
        { reportId: repoCallArg.id },
        { jobId: repoCallArg.id },
      );

      // Verify returned response
      expect(response).toEqual({
        jobId: mockCreatedRecord.id,
        status: REPORT_STATUS.PENDING,
        statusUrl: `/api/reports/${mockCreatedRecord.id}`,
      });
    });
  });

  describe('generateReport - Failure compensation flow', () => {
    it('marks report PERMANENTLY_FAILED and throws ServiceUnavailableError when queue.add fails', async () => {
      const input = {
        reportType: 'analytics' as const,
        format: 'csv' as const,
        rowCount: 50,
      };

      const mockCreatedRecord: Report = {
        id: 'mock-failed-uuid',
        status: REPORT_STATUS.PENDING,
        params: input,
        attempts: 0,
        file_path: null,
        error_trace: null,
        created_at: new Date(),
        updated_at: new Date(),
        started_at: null,
        completed_at: null,
      };

      createMock.mockResolvedValue(mockCreatedRecord);
      const queueError = new Error('Redis connection refused: ECONNREFUSED 127.0.0.1:6379');
      queueAddMock.mockRejectedValue(queueError);
      markPermanentlyFailedMock.mockResolvedValue({
        ...mockCreatedRecord,
        status: REPORT_STATUS.PERMANENTLY_FAILED,
        error_trace: queueError.stack ?? queueError.message,
      });

      await expect(service.generateReport(input)).rejects.toThrow(ServiceUnavailableError);

      // Verify repository compensation was invoked with failure trace
      expect(markPermanentlyFailedMock).toHaveBeenCalledTimes(1);
      const generatedId = (createMock.mock.calls[0]?.[0] as { id: string }).id;
      const [failedId, trace] = (markPermanentlyFailedMock.mock.calls[0] ?? []) as [string, string];
      expect(failedId).toBe(generatedId);
      expect(trace).toContain('ECONNREFUSED');
    });
  });

  describe('getReportStatus', () => {
    it('returns mapped ReportStatusResponse when report exists', async () => {
      const mockRecord: Report = {
        id: 'mock-status-uuid',
        status: REPORT_STATUS.COMPLETED,
        params: { reportType: 'invoice', format: 'pdf', rowCount: 10 },
        attempts: 1,
        file_path: '/reports/file.pdf',
        error_trace: null,
        created_at: new Date('2026-09-30T10:00:00.000Z'),
        updated_at: new Date('2026-09-30T10:00:10.000Z'),
        started_at: new Date('2026-09-30T10:00:01.000Z'),
        completed_at: new Date('2026-09-30T10:00:10.000Z'),
      };

      findByIdMock.mockResolvedValue(mockRecord);

      const result = await service.getReportStatus('mock-status-uuid');

      expect(findByIdMock).toHaveBeenCalledWith('mock-status-uuid');
      expect(result).toEqual({
        jobId: 'mock-status-uuid',
        status: REPORT_STATUS.COMPLETED,
        attempts: 1,
        createdAt: '2026-09-30T10:00:00.000Z',
        updatedAt: '2026-09-30T10:00:10.000Z',
        downloadUrl: '/api/reports/mock-status-uuid/download',
        errorMessage: null,
      });
    });

    it('returns null when report does not exist in repository', async () => {
      findByIdMock.mockResolvedValue(null);

      const result = await service.getReportStatus('non-existent-uuid');

      expect(findByIdMock).toHaveBeenCalledWith('non-existent-uuid');
      expect(result).toBeNull();
    });
  });
});
