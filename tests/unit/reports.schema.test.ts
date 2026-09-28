/**
 * tests/unit/reports.schema.test.ts
 *
 * Exhaustive unit tests for report generation request validation schema.
 */
import { describe, it, expect } from 'vitest';
import { generateReportSchema } from '../../src/modules/reports/reports.schema';

describe('generateReportSchema', () => {
  describe('Valid inputs', () => {
    it('accepts valid minimal input with invoice and pdf', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 100,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it('accepts valid input with analytics and csv and title', () => {
      const input = {
        reportType: 'analytics',
        format: 'csv',
        rowCount: 250,
        title: 'Quarterly Sales Summary',
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it('accepts boundary rowCount values (1 and 500)', () => {
      const minResult = generateReportSchema.safeParse({
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 1,
      });
      expect(minResult.success).toBe(true);

      const maxResult = generateReportSchema.safeParse({
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 500,
      });
      expect(maxResult.success).toBe(true);
    });

    it('accepts max allowed title length (100 characters)', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 50,
        title: 'A'.repeat(100),
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid inputs', () => {
    it('rejects unsupported reportType', () => {
      const input = {
        reportType: 'tax_return',
        format: 'pdf',
        rowCount: 10,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('reportType'));
        expect(error).toBeDefined();
      }
    });

    it('rejects unsupported format', () => {
      const input = {
        reportType: 'invoice',
        format: 'xlsx',
        rowCount: 10,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('format'));
        expect(error).toBeDefined();
      }
    });

    it('rejects rowCount less than 1', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 0,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('rowCount'));
        expect(error).toBeDefined();
      }
    });

    it('rejects rowCount greater than 500', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 501,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('rowCount'));
        expect(error).toBeDefined();
      }
    });

    it('rejects non-integer rowCount', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 25.5,
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('rowCount'));
        expect(error).toBeDefined();
      }
    });

    it('rejects missing rowCount', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('rowCount'));
        expect(error).toBeDefined();
      }
    });

    it('rejects title longer than 100 characters', () => {
      const input = {
        reportType: 'invoice',
        format: 'pdf',
        rowCount: 10,
        title: 'A'.repeat(101),
      };

      const result = generateReportSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes('title'));
        expect(error).toBeDefined();
      }
    });

    it('rejects non-object payload', () => {
      const result = generateReportSchema.safeParse('not an object');
      expect(result.success).toBe(false);
    });
  });
});
