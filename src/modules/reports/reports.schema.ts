/**
 * src/modules/reports/reports.schema.ts
 *
 * Zod validation schema for POST /api/reports/generate requests.
 *
 * Validation rules:
 * - reportType: required enum ('invoice' | 'analytics')
 * - format: required enum ('pdf' | 'csv')
 * - rowCount: required integer between 1 and 500
 * - title: optional string, maximum 100 characters
 */
import { z } from 'zod';

export const generateReportSchema = z.object({
  reportType: z.enum(['invoice', 'analytics'], {
    message: "reportType must be either 'invoice' or 'analytics'",
  }),

  format: z.enum(['pdf', 'csv'], {
    message: "format must be either 'pdf' or 'csv'",
  }),

  rowCount: z
    .number({
      message: 'rowCount must be an integer between 1 and 500',
    })
    .int({ message: 'rowCount must be an integer' })
    .min(1, { message: 'rowCount must be at least 1' })
    .max(500, { message: 'rowCount must be at most 500' }),

  title: z
    .string()
    .trim()
    .min(1, { message: 'title cannot be empty when provided' })
    .max(100, { message: 'title must be at most 100 characters' })
    .optional(),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
