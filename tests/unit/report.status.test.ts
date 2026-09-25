/**
 * tests/unit/report.status.test.ts
 *
 * Exhaustive unit tests for report state machine and transition guards.
 */
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  assertValidTransition,
  canTransition,
  InvalidStateTransitionError,
} from '../../src/modules/reports/report.status';
import { REPORT_STATUS, ReportStatus } from '../../src/modules/reports/report.types';

describe('Report State Machine Transitions', () => {
  const allStatuses: ReportStatus[] = [
    REPORT_STATUS.PENDING,
    REPORT_STATUS.PROCESSING,
    REPORT_STATUS.COMPLETED,
    REPORT_STATUS.FAILED,
    REPORT_STATUS.PERMANENTLY_FAILED,
  ];

  describe('Allowed transitions', () => {
    it('allows PENDING -> PROCESSING and PENDING -> PERMANENTLY_FAILED', () => {
      expect(canTransition(REPORT_STATUS.PENDING, REPORT_STATUS.PROCESSING)).toBe(true);
      expect(canTransition(REPORT_STATUS.PENDING, REPORT_STATUS.PERMANENTLY_FAILED)).toBe(true);
    });

    it('allows PROCESSING -> COMPLETED, PROCESSING -> FAILED, and PROCESSING -> PERMANENTLY_FAILED', () => {
      expect(canTransition(REPORT_STATUS.PROCESSING, REPORT_STATUS.COMPLETED)).toBe(true);
      expect(canTransition(REPORT_STATUS.PROCESSING, REPORT_STATUS.FAILED)).toBe(true);
      expect(canTransition(REPORT_STATUS.PROCESSING, REPORT_STATUS.PERMANENTLY_FAILED)).toBe(true);
    });

    it('allows FAILED -> PROCESSING and FAILED -> PERMANENTLY_FAILED', () => {
      expect(canTransition(REPORT_STATUS.FAILED, REPORT_STATUS.PROCESSING)).toBe(true);
      expect(canTransition(REPORT_STATUS.FAILED, REPORT_STATUS.PERMANENTLY_FAILED)).toBe(true);
    });
  });

  describe('Rejected transitions', () => {
    it('rejects illegal transitions from PENDING', () => {
      expect(canTransition(REPORT_STATUS.PENDING, REPORT_STATUS.COMPLETED)).toBe(false);
      expect(canTransition(REPORT_STATUS.PENDING, REPORT_STATUS.FAILED)).toBe(false);
      expect(canTransition(REPORT_STATUS.PENDING, REPORT_STATUS.PENDING)).toBe(false);
    });

    it('rejects illegal transitions from PROCESSING', () => {
      expect(canTransition(REPORT_STATUS.PROCESSING, REPORT_STATUS.PENDING)).toBe(false);
      expect(canTransition(REPORT_STATUS.PROCESSING, REPORT_STATUS.PROCESSING)).toBe(false);
    });

    it('rejects illegal transitions from FAILED', () => {
      expect(canTransition(REPORT_STATUS.FAILED, REPORT_STATUS.PENDING)).toBe(false);
      expect(canTransition(REPORT_STATUS.FAILED, REPORT_STATUS.COMPLETED)).toBe(false);
      expect(canTransition(REPORT_STATUS.FAILED, REPORT_STATUS.FAILED)).toBe(false);
    });

    it('rejects any transition from terminal COMPLETED state', () => {
      for (const target of allStatuses) {
        expect(canTransition(REPORT_STATUS.COMPLETED, target)).toBe(false);
      }
    });

    it('rejects any transition from terminal PERMANENTLY_FAILED state', () => {
      for (const target of allStatuses) {
        expect(canTransition(REPORT_STATUS.PERMANENTLY_FAILED, target)).toBe(false);
      }
    });
  });

  describe('assertValidTransition', () => {
    it('does not throw when transition is valid', () => {
      expect(() =>
        assertValidTransition(REPORT_STATUS.PENDING, REPORT_STATUS.PROCESSING),
      ).not.toThrow();
    });

    it('throws InvalidStateTransitionError with metadata when transition is invalid', () => {
      const testReportId = '123e4567-e89b-12d3-a456-426614174000';

      expect(() =>
        assertValidTransition(REPORT_STATUS.PENDING, REPORT_STATUS.COMPLETED, testReportId),
      ).toThrow(InvalidStateTransitionError);

      try {
        assertValidTransition(REPORT_STATUS.PENDING, REPORT_STATUS.COMPLETED, testReportId);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidStateTransitionError);
        const transitionError = err as InvalidStateTransitionError;
        expect(transitionError.from).toBe(REPORT_STATUS.PENDING);
        expect(transitionError.to).toBe(REPORT_STATUS.COMPLETED);
        expect(transitionError.reportId).toBe(testReportId);
        expect(transitionError.message).toContain('PENDING');
        expect(transitionError.message).toContain('COMPLETED');
        expect(transitionError.message).toContain(testReportId);
      }
    });
  });

  describe('ALLOWED_TRANSITIONS map integrity', () => {
    it('covers all five domain statuses', () => {
      expect(Object.keys(ALLOWED_TRANSITIONS)).toHaveLength(5);
      for (const status of allStatuses) {
        expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
      }
    });
  });
});
