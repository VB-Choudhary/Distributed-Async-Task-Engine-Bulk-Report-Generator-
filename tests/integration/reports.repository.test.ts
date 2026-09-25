/**
 * tests/integration/reports.repository.test.ts
 *
 * Integration tests for ReportsRepository running against the dedicated test database (reports_test).
 *
 * Tests:
 * - create: default values, JSON parameters, UUID generation, timestamps
 * - findById: found and not-found semantics
 * - markProcessing: attempts increment, started_at assignment, guarded state transition
 * - markCompleted: file_path, completed_at assignment, guarded state transition
 * - markFailed: error_trace assignment, guarded state transition
 * - markPermanentlyFailed: transition from PENDING, PROCESSING, FAILED, terminal guard
 * - Guard condition enforcement: rejects illegal transitions (returns null)
 *
 * Safe execution:
 * Gracefully skips if the test database is not reachable.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { createDatabasePool, getTestDatabaseUrl } from '../../src/lib/db';
import { ReportsRepository } from '../../src/modules/reports/reports.repository';
import { REPORT_STATUS } from '../../src/modules/reports/report.types';

describe('ReportsRepository Integration (reports_test database)', () => {
  const testDbUrl = getTestDatabaseUrl();
  let testPool: Pool;
  let repo: ReportsRepository;
  let isDbAvailable = false;

  beforeAll(async () => {
    testPool = createDatabasePool(testDbUrl);

    try {
      const client = await testPool.connect();
      client.release();
      isDbAvailable = true;

      // Apply migrations to test database
      await runner({
        databaseUrl: testDbUrl,
        dir: 'migrations',
        direction: 'up',
        migrationsTable: 'pgmigrations',
        verbose: false,
      });

      repo = new ReportsRepository(testPool);
    } catch {
      isDbAvailable = false;
      // Do not crash test runner if PostgreSQL container is offline
    }
  });

  afterAll(async () => {
    if (testPool) {
      await testPool.end();
    }
  });

  beforeEach(async () => {
    if (!isDbAvailable) return;
    // Clean reports table between tests for isolation
    await testPool.query('TRUNCATE TABLE reports CASCADE;');
  });

  it('creates a new report in PENDING status with attempts = 0', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const report = await repo.create({
      params: { startDate: '2026-01-01', endDate: '2026-01-31', format: 'pdf' },
    });

    expect(report.id).toBeDefined();
    expect(report.status).toBe(REPORT_STATUS.PENDING);
    expect(report.attempts).toBe(0);
    expect(report.file_path).toBeNull();
    expect(report.error_trace).toBeNull();
    expect(report.started_at).toBeNull();
    expect(report.completed_at).toBeNull();
    expect(report.created_at).toBeInstanceOf(Date);
    expect(report.updated_at).toBeInstanceOf(Date);
    expect(report.params).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      format: 'pdf',
    });
  });

  it('finds an existing report by ID and returns null for non-existent ID', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const created = await repo.create({ params: { format: 'csv' } });
    const found = await repo.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.params).toEqual({ format: 'csv' });

    const nonExistent = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(nonExistent).toBeNull();
  });

  it('transitions PENDING -> PROCESSING, increments attempts, and sets started_at', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const created = await repo.create({ params: { format: 'pdf' } });
    expect(created.attempts).toBe(0);
    expect(created.started_at).toBeNull();

    const processing = await repo.markProcessing(created.id);

    expect(processing).not.toBeNull();
    expect(processing?.status).toBe(REPORT_STATUS.PROCESSING);
    expect(processing?.attempts).toBe(1);
    expect(processing?.started_at).toBeInstanceOf(Date);
    expect(processing?.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
  });

  it('transitions FAILED -> PROCESSING and increments attempts again', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const created = await repo.create({ params: { format: 'pdf' } });
    await repo.markProcessing(created.id);
    await repo.markFailed(created.id, 'Temporary connection timeout');

    const retried = await repo.markProcessing(created.id);

    expect(retried).not.toBeNull();
    expect(retried?.status).toBe(REPORT_STATUS.PROCESSING);
    expect(retried?.attempts).toBe(2);
  });

  it('transitions PROCESSING -> COMPLETED and records file_path and completed_at', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const created = await repo.create({ params: { format: 'pdf' } });
    await repo.markProcessing(created.id);

    const completed = await repo.markCompleted(created.id, '/reports/invoice-123.pdf');

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe(REPORT_STATUS.COMPLETED);
    expect(completed?.file_path).toBe('/reports/invoice-123.pdf');
    expect(completed?.completed_at).toBeInstanceOf(Date);
  });

  it('transitions PROCESSING -> FAILED and records error_trace', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    const created = await repo.create({ params: { format: 'pdf' } });
    await repo.markProcessing(created.id);

    const failed = await repo.markFailed(created.id, 'OutOfMemoryError: Heap allocation failed');

    expect(failed).not.toBeNull();
    expect(failed?.status).toBe(REPORT_STATUS.FAILED);
    expect(failed?.error_trace).toBe('OutOfMemoryError: Heap allocation failed');
  });

  it('transitions to PERMANENTLY_FAILED from PENDING, PROCESSING, and FAILED', async (ctx) => {
    if (!isDbAvailable) ctx.skip();

    // From PENDING
    const r1 = await repo.create({ params: { bad: true } });
    const pf1 = await repo.markPermanentlyFailed(r1.id, 'Fatal: Malformed parameters');
    expect(pf1?.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);
    expect(pf1?.completed_at).toBeInstanceOf(Date);

    // From PROCESSING
    const r2 = await repo.create({ params: { format: 'pdf' } });
    await repo.markProcessing(r2.id);
    const pf2 = await repo.markPermanentlyFailed(r2.id, 'Fatal: Corrupted template');
    expect(pf2?.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);

    // From FAILED
    const r3 = await repo.create({ params: { format: 'pdf' } });
    await repo.markProcessing(r3.id);
    await repo.markFailed(r3.id, 'Retry failed');
    const pf3 = await repo.markPermanentlyFailed(r3.id, 'Fatal: Max retries exceeded');
    expect(pf3?.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);
  });

  describe('Race and Guard Protections', () => {
    it('rejects markCompleted on a report that is PENDING (returns null)', async (ctx) => {
      if (!isDbAvailable) ctx.skip();

      const created = await repo.create({ params: { format: 'pdf' } });
      const completed = await repo.markCompleted(created.id, '/path/test.pdf');

      expect(completed).toBeNull();
      const current = await repo.findById(created.id);
      expect(current?.status).toBe(REPORT_STATUS.PENDING);
    });

    it('rejects markFailed on a report that is PENDING (returns null)', async (ctx) => {
      if (!isDbAvailable) ctx.skip();

      const created = await repo.create({ params: { format: 'pdf' } });
      const failed = await repo.markFailed(created.id, 'Premature failure');

      expect(failed).toBeNull();
      const current = await repo.findById(created.id);
      expect(current?.status).toBe(REPORT_STATUS.PENDING);
    });

    it('rejects markProcessing on a COMPLETED report (terminal guard)', async (ctx) => {
      if (!isDbAvailable) ctx.skip();

      const created = await repo.create({ params: { format: 'pdf' } });
      await repo.markProcessing(created.id);
      await repo.markCompleted(created.id, '/done.pdf');

      const reprocessed = await repo.markProcessing(created.id);

      expect(reprocessed).toBeNull();
      const current = await repo.findById(created.id);
      expect(current?.status).toBe(REPORT_STATUS.COMPLETED);
    });

    it('rejects markProcessing on a PERMANENTLY_FAILED report (terminal guard)', async (ctx) => {
      if (!isDbAvailable) ctx.skip();

      const created = await repo.create({ params: { format: 'pdf' } });
      await repo.markPermanentlyFailed(created.id, 'Dead forever');

      const reprocessed = await repo.markProcessing(created.id);

      expect(reprocessed).toBeNull();
      const current = await repo.findById(created.id);
      expect(current?.status).toBe(REPORT_STATUS.PERMANENTLY_FAILED);
    });
  });
});
