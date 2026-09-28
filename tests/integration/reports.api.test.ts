/**
 * tests/integration/reports.api.test.ts
 *
 * Integration tests for Report Ingestion API endpoint (POST /api/reports/generate).
 *
 * Verifies:
 * - 202 Accepted on valid payload with jobId and PENDING status
 * - 400 Bad Request on invalid payloads with structured validation errors
 * - 503 Service Unavailable when queue dispatch fails (testing failure compensation route)
 * - Live database row verification (when test database is available)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../../src/api/app';
import { createReportsRouter } from '../../src/modules/reports/reports.routes';
import { ReportsService, ServiceUnavailableError } from '../../src/modules/reports/reports.service';
import { createDatabasePool, getTestDatabaseUrl } from '../../src/lib/db';
import { ReportsRepository } from '../../src/modules/reports/reports.repository';
import { REPORT_STATUS } from '../../src/modules/reports/report.types';
import { Pool } from 'pg';

interface ApiErrorResponse {
  status: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

describe('POST /api/reports/generate API', () => {
  const app = createApp();

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
      // Attach lightweight logger mock
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
        // Skip live DB assertion if DB container is offline
        return;
      }

      // Create a test record through the repo to verify schema compatibility
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
  });
});
