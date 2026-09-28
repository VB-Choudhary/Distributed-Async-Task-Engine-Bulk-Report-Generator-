/**
 * src/modules/reports/reports.routes.ts
 *
 * HTTP route handlers for report generation.
 *
 * Endpoints:
 * - POST /generate: Validates request parameters, inserts a PENDING report,
 *   dispatches the job to the BullMQ queue, and returns HTTP 202 Accepted.
 */
import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { generateReportSchema } from './reports.schema';
import { reportsService, ReportsService, ServiceUnavailableError } from './reports.service';

/**
 * Creates the reports router with configurable service for testing.
 */
export function createReportsRouter(service: ReportsService = reportsService): Router {
  const router = Router();

  // Enforce JSON body parser with strict size limit (100kb)
  router.use(express.json({ limit: '100kb' }));

  /**
   * POST /generate
   * Accepts report parameters, validates with Zod, and enqueues background processing.
   */
  router.post(
    '/generate',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const startTime = performance.now();

      // 1. Validate request body
      const parseResult = generateReportSchema.safeParse(req.body);

      if (!parseResult.success) {
        const formattedErrors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));

        res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: formattedErrors,
        });
        return;
      }

      // 2. Delegate to service
      try {
        const response = await service.generateReport(parseResult.data);
        const durationMs = Number((performance.now() - startTime).toFixed(2));

        // Log request handling duration with request ID and job ID
        res.log.info(
          {
            jobId: response.jobId,
            reportType: parseResult.data.reportType,
            format: parseResult.data.format,
            rowCount: parseResult.data.rowCount,
            durationMs,
          },
          'Report generation job accepted',
        );

        res.status(202).json(response);
      } catch (error) {
        if (error instanceof ServiceUnavailableError) {
          const durationMs = Number((performance.now() - startTime).toFixed(2));
          res.log.error(
            { err: error, durationMs },
            'Failed to accept report generation job (queue unavailable)',
          );

          res.status(503).json({
            status: 'error',
            message: error.message,
          });
          return;
        }

        next(error);
      }
    },
  );

  return router;
}

export const reportsRouter = createReportsRouter();
