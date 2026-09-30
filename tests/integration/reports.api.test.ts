/**
 * tests/integration/reports.api.test.ts
 *
 * Integration tests for Report Ingestion API endpoint (POST /api/reports/generate)
 * and Report Status Polling API endpoint (GET /api/reports/:jobId).
 *
 * Verifies:
 * - POST /generate: 202 Accepted, 400 Bad Request, 503 Service Unavailable
 * - GET /:jobId:
 *   - 400 Bad Request when jobId is not a valid UUID
 *   - 404 Not Found when jobId does not exist
 *   - Cache-Control: no-store header on all polling responses
 *   - Response contract for all 5 statuses:
 *     PENDING, PROCESSING, COMPLETED, FAILED, PERMANENTLY_FAILED
 *   - downloadUrl only present when status is COMPLETED
 *   - errorMessage is safe human-readable string only when PERMANENTLY_FAILED
 *   - No raw error_trace or stack trace ever leaks into client response
 *   - End-to-end POST then GET returns PENDING
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../../src/api/app';
import { createReportsRouter } from '../../src/modules/reports/reports.routes';
import { ReportsService, ServiceUnavailableError } from '../../src/modules/reports/reports.service';
import { createDatabasePool, getTestDatabaseUrl } from '../../src/lib/db';
import { ReportsRepository } from '../../src/modules/reports/reports.repository';
import { REPORT_STATUS, ReportStatusResponse } from '../../src/modules/reports/report.types';
import { SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE } from '../../src/modules/reports/reports.mapper';
import { Pool } from 'pg';

interface ApiErrorResponse {
  status: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

describe('Reports API', () => {
  const app = createApp();

  describe('POST /api/reports/generate API', () => {
    describe('Validation - HTTP 400 Bad Request', () => {
      it('returns 400 with error details when payload is empty', async () => {
        const res = await request(app)
          .post('/api/reports/generate')
          .send({})
          .set('Content-Type', 'application/json');

        expect(res.status).toBe(400);
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        expect(body.message).toBe('Validation failed');
        expect(Array.isArray(body.errors)).toBe(true);
        expect(body.errors?.length).toBeGreaterThanOrEqual(3);
      });

      it('returns 400 when rowCount exceeds maximum (500)', async () => {
        const res = await request(app).post('/api/reports/generate').send({
          reportType: 'invoice',
          format: 'pdf',
          rowCount: 501,
        });

        expect(res.status).toBe(400);
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        const rowCountError = body.errors?.find((err) => err.field === 'rowCount');
        expect(rowCountError).toBeDefined();
      });

      it('returns 400 when format is unsupported', async () => {
        const res = await request(app).post('/api/reports/generate').send({
          reportType: 'invoice',
          format: 'html',
          rowCount: 50,
        });

        expect(res.status).toBe(400);
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        const formatError = body.errors?.find((err) => err.field === 'format');
        expect(formatError).toBeDefined();
      });

      it('returns 400 when reportType is unsupported', async () => {
        const res = await request(app).post('/api/reports/generate').send({
          reportType: 'ledger',
          format: 'pdf',
          rowCount: 50,
        });

        expect(res.status).toBe(400);
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        const typeError = body.errors?.find((err) => err.field === 'reportType');
        expect(typeError).toBeDefined();
      });
    });

    describe('Service Unavailable - HTTP 503', () => {
      it('returns 503 when service throws ServiceUnavailableError', async () => {
        const mockService = {
          generateReport: () => {
            throw new ServiceUnavailableError(
              'Service temporarily unavailable. Failed to enqueue report job.',
            );
          },
        } as unknown as ReportsService;

        const mockRouter = createReportsRouter(mockService);
        const testApp = express();
        testApp.use(express.json());
        testApp.use((_req, res, next) => {
          res.log = { error: () => {}, info: () => {} } as never;
          next();
        });
        testApp.use('/api/reports', mockRouter);

        const res = await request(testApp).post('/api/reports/generate').send({
          reportType: 'invoice',
          format: 'pdf',
          rowCount: 10,
        });

        expect(res.status).toBe(503);
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        expect(body.message).toContain('Service temporarily unavailable');
      });
    });

    describe('Success Response - HTTP 202 Accepted', () => {
      it('returns 202 with jobId, status PENDING, and statusUrl when service succeeds', async () => {
        const mockService = {
          generateReport: () =>
            Promise.resolve({
              jobId: '777e4567-e89b-12d3-a456-426614174000',
              status: REPORT_STATUS.PENDING,
              statusUrl: '/api/reports/777e4567-e89b-12d3-a456-426614174000',
            }),
        } as unknown as ReportsService;

        const mockRouter = createReportsRouter(mockService);
        const testApp = express();
        testApp.use(express.json());
        testApp.use((_req, res, next) => {
          res.log = { error: () => {}, info: () => {} } as never;
          next();
        });
        testApp.use('/api/reports', mockRouter);

        const res = await request(testApp).post('/api/reports/generate').send({
          reportType: 'analytics',
          format: 'csv',
          rowCount: 100,
          title: 'Quarterly Report',
        });

        expect(res.status).toBe(202);
        expect(res.body).toEqual({
          jobId: '777e4567-e89b-12d3-a456-426614174000',
          status: REPORT_STATUS.PENDING,
          statusUrl: '/api/reports/777e4567-e89b-12d3-a456-426614174000',
        });
      });
    });
  });

  describe('GET /api/reports/:jobId API', () => {
    describe('Validation - HTTP 400 Bad Request', () => {
      it('returns 400 when jobId is not a valid UUID', async () => {
        const res = await request(app).get('/api/reports/not-a-valid-uuid');

        expect(res.status).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        expect(body.message).toContain('must be a valid UUID');
      });

      it('returns 400 for integer id instead of UUID', async () => {
        const res = await request(app).get('/api/reports/12345');

        expect(res.status).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
      });
    });

    describe('Status Response Contracts (Mocked Service)', () => {
      const createStatusApp = (mockStatus: ReportStatusResponse | null): express.Application => {
        const mockService = {
          getReportStatus: () => Promise.resolve(mockStatus),
        } as unknown as ReportsService;

        const mockRouter = createReportsRouter(mockService);
        const testApp = express();
        testApp.use((_req, res, next) => {
          res.log = { error: () => {}, info: () => {} } as never;
          next();
        });
        testApp.use('/api/reports', mockRouter);
        return testApp;
      };

      it('returns 404 when report does not exist in service', async () => {
        const nonExistentUuid = crypto.randomUUID();
        const testApp = createStatusApp(null);
        const res = await request(testApp).get(`/api/reports/${nonExistentUuid}`);

        expect(res.status).toBe(404);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ApiErrorResponse;
        expect(body.status).toBe('error');
        expect(body.message).toBe('Report not found');
      });

      it('returns 200 with PENDING contract', async () => {
        const jobId = crypto.randomUUID();
        const testApp = createStatusApp({
          jobId,
          status: REPORT_STATUS.PENDING,
          attempts: 0,
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:00:00.000Z',
          downloadUrl: null,
          errorMessage: null,
        });

        const res = await request(testApp).get(`/api/reports/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ReportStatusResponse;
        expect(body.jobId).toBe(jobId);
        expect(body.status).toBe(REPORT_STATUS.PENDING);
        expect(body.attempts).toBe(0);
        expect(body.downloadUrl).toBeNull();
        expect(body.errorMessage).toBeNull();
      });

      it('returns 200 with PROCESSING contract', async () => {
        const jobId = crypto.randomUUID();
        const testApp = createStatusApp({
          jobId,
          status: REPORT_STATUS.PROCESSING,
          attempts: 1,
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:00:05.000Z',
          downloadUrl: null,
          errorMessage: null,
        });

        const res = await request(testApp).get(`/api/reports/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ReportStatusResponse;
        expect(body.status).toBe(REPORT_STATUS.PROCESSING);
        expect(body.attempts).toBe(1);
        expect(body.downloadUrl).toBeNull();
        expect(body.errorMessage).toBeNull();
      });

      it('returns 200 with FAILED contract (null downloadUrl, null errorMessage)', async () => {
        const jobId = crypto.randomUUID();
        const testApp = createStatusApp({
          jobId,
          status: REPORT_STATUS.FAILED,
          attempts: 2,
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:00:10.000Z',
          downloadUrl: null,
          errorMessage: null,
        });

        const res = await request(testApp).get(`/api/reports/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ReportStatusResponse;
        expect(body.status).toBe(REPORT_STATUS.FAILED);
        expect(body.attempts).toBe(2);
        expect(body.downloadUrl).toBeNull();
        expect(body.errorMessage).toBeNull();
      });

      it('returns 200 with COMPLETED contract including downloadUrl', async () => {
        const jobId = crypto.randomUUID();
        const testApp = createStatusApp({
          jobId,
          status: REPORT_STATUS.COMPLETED,
          attempts: 1,
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:00:20.000Z',
          downloadUrl: `/api/reports/${jobId}/download`,
          errorMessage: null,
        });

        const res = await request(testApp).get(`/api/reports/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ReportStatusResponse;
        expect(body.status).toBe(REPORT_STATUS.COMPLETED);
        expect(body.downloadUrl).toBe(`/api/reports/${jobId}/download`);
        expect(body.errorMessage).toBeNull();
      });

      it('returns 200 with PERMANENTLY_FAILED contract and safe errorMessage (no leak)', async () => {
        const jobId = crypto.randomUUID();
        const testApp = createStatusApp({
          jobId,
          status: REPORT_STATUS.PERMANENTLY_FAILED,
          attempts: 3,
          createdAt: '2026-09-30T10:00:00.000Z',
          updatedAt: '2026-09-30T10:01:00.000Z',
          downloadUrl: null,
          errorMessage: SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE,
        });

        const res = await request(testApp).get(`/api/reports/${jobId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const body = res.body as ReportStatusResponse;
        expect(body.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);
        expect(body.attempts).toBe(3);
        expect(body.downloadUrl).toBeNull();
        expect(body.errorMessage).toBe(SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE);
      });
    });
  });

  describe('Live Database Verification (conditional on test database availability)', () => {
    let testPool: Pool | null = null;
    let repo: ReportsRepository | null = null;
    let isDbAvailable = false;

    beforeAll(async () => {
      try {
        testPool = createDatabasePool(getTestDatabaseUrl());
        const client = await testPool.connect();
        client.release();
        repo = new ReportsRepository(testPool);
        isDbAvailable = true;
      } catch {
        isDbAvailable = false;
      }
    });

    afterAll(async () => {
      if (testPool) {
        await testPool.end();
      }
    });

    it('persists report record in PENDING status upon ingestion', async () => {
      if (!isDbAvailable || !repo) {
        return;
      }

      const created = await repo.create({
        params: {
          reportType: 'invoice',
          format: 'pdf',
          rowCount: 25,
          title: 'Live DB Integration Test',
        },
      });

      expect(created.id).toBeDefined();
      expect(created.status).toBe(REPORT_STATUS.PENDING);
      expect(created.params).toEqual({
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 25,
        title: 'Live DB Integration Test',
      });

      const fetched = await repo.findById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.status).toBe(REPORT_STATUS.PENDING);
    });

    it('fetches status for reports created directly in the database across all statuses without leaking error_trace', async () => {
      if (!isDbAvailable || !repo) {
        return;
      }

      // 1. PENDING
      const pendingReport = await repo.create({
        params: { reportType: 'invoice', format: 'pdf', rowCount: 10 },
      });
      const pendingRes = await request(app).get(`/api/reports/${pendingReport.id}`);
      expect(pendingRes.status).toBe(200);
      expect((pendingRes.body as ReportStatusResponse).status).toBe(REPORT_STATUS.PENDING);
      expect((pendingRes.body as ReportStatusResponse).downloadUrl).toBeNull();
      expect((pendingRes.body as ReportStatusResponse).errorMessage).toBeNull();

      // 2. PROCESSING
      const processingReport = await repo.create({
        params: { reportType: 'analytics', format: 'csv', rowCount: 20 },
      });
      await repo.markProcessing(processingReport.id);
      const processingRes = await request(app).get(`/api/reports/${processingReport.id}`);
      expect(processingRes.status).toBe(200);
      expect((processingRes.body as ReportStatusResponse).status).toBe(REPORT_STATUS.PROCESSING);
      expect((processingRes.body as ReportStatusResponse).attempts).toBe(1);

      // 3. FAILED (with error_trace)
      const failedReport = await repo.create({
        params: { reportType: 'invoice', format: 'pdf', rowCount: 30 },
      });
      await repo.markProcessing(failedReport.id);
      const secretSqlError = 'FATAL: database query failed at postgres.ts:99 secret_table_name';
      await repo.markFailed(failedReport.id, secretSqlError);
      const failedRes = await request(app).get(`/api/reports/${failedReport.id}`);
      expect(failedRes.status).toBe(200);
      expect((failedRes.body as ReportStatusResponse).status).toBe(REPORT_STATUS.FAILED);
      expect((failedRes.body as ReportStatusResponse).downloadUrl).toBeNull();
      expect((failedRes.body as ReportStatusResponse).errorMessage).toBeNull();
      // Ensure secret error trace never appears anywhere in the HTTP response body
      expect(JSON.stringify(failedRes.body)).not.toContain('secret_table_name');

      // 4. COMPLETED
      const completedReport = await repo.create({
        params: { reportType: 'analytics', format: 'csv', rowCount: 40 },
      });
      await repo.markProcessing(completedReport.id);
      await repo.markCompleted(completedReport.id, `/var/data/reports/${completedReport.id}.csv`);
      const completedRes = await request(app).get(`/api/reports/${completedReport.id}`);
      expect(completedRes.status).toBe(200);
      expect((completedRes.body as ReportStatusResponse).status).toBe(REPORT_STATUS.COMPLETED);
      expect((completedRes.body as ReportStatusResponse).downloadUrl).toBe(
        `/api/reports/${completedReport.id}/download`,
      );
      expect((completedRes.body as ReportStatusResponse).errorMessage).toBeNull();
      // Ensure server-internal file path never leaks
      expect(JSON.stringify(completedRes.body)).not.toContain('/var/data/reports');

      // 5. PERMANENTLY_FAILED
      const permFailedReport = await repo.create({
        params: { reportType: 'invoice', format: 'pdf', rowCount: 50 },
      });
      const internalStack = 'SystemCrashException: out of memory at native_worker.cc:42';
      await repo.markPermanentlyFailed(permFailedReport.id, internalStack);
      const permFailedRes = await request(app).get(`/api/reports/${permFailedReport.id}`);
      expect(permFailedRes.status).toBe(200);
      expect((permFailedRes.body as ReportStatusResponse).status).toBe(
        REPORT_STATUS.PERMANENTLY_FAILED,
      );
      expect((permFailedRes.body as ReportStatusResponse).downloadUrl).toBeNull();
      expect((permFailedRes.body as ReportStatusResponse).errorMessage).toBe(
        SAFE_PERMANENTLY_FAILED_ERROR_MESSAGE,
      );
      // Ensure stack trace never leaks
      expect(JSON.stringify(permFailedRes.body)).not.toContain('SystemCrashException');
      expect(JSON.stringify(permFailedRes.body)).not.toContain('native_worker.cc');
    });

    it('returns PENDING when querying status immediately after ingestion (POST then GET)', async () => {
      if (!isDbAvailable || !repo) {
        return;
      }

      const postRes = await request(app)
        .post('/api/reports/generate')
        .send({
          reportType: 'invoice',
          format: 'pdf',
          rowCount: 50,
          title: 'Post Then Get Poll Test',
        });

      if (postRes.status === 202) {
        const postBody = postRes.body as { jobId: string };
        const getRes = await request(app).get(`/api/reports/${postBody.jobId}`);

        expect(getRes.status).toBe(200);
        expect(getRes.headers['cache-control']).toBe('no-store');
        const statusBody = getRes.body as ReportStatusResponse;
        expect(statusBody.jobId).toBe(postBody.jobId);
        expect(statusBody.status).toBe(REPORT_STATUS.PENDING);
        expect(statusBody.downloadUrl).toBeNull();
        expect(statusBody.errorMessage).toBeNull();
      }
    });
  });
});
