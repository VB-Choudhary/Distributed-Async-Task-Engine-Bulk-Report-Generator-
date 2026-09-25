/**
 * src/modules/reports/report.status.ts
 *
 * Report state machine definition and transition validation.
 *
 * Allowed transitions:
 * - PENDING   -> PROCESSING | PERMANENTLY_FAILED
 * - PROCESSING -> COMPLETED | FAILED | PERMANENTLY_FAILED
 * - FAILED     -> PROCESSING | PERMANENTLY_FAILED
 *
 * Terminal states:
 * - COMPLETED          (no transitions allowed)
 * - PERMANENTLY_FAILED (no transitions allowed)
 */
import { REPORT_STATUS, ReportStatus } from './report.types';

export class InvalidStateTransitionError extends Error {
  public readonly from: ReportStatus;
  public readonly to: ReportStatus;
  public readonly reportId: string | undefined;

  constructor(from: ReportStatus, to: ReportStatus, reportId?: string) {
    super(
      `Invalid report status transition from '${from}' to '${to}'${
        reportId ? ` for report '${reportId}'` : ''
      }`,
    );
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
    this.reportId = reportId;
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

/**
 * State transition map defining allowed target statuses for each current status.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  [REPORT_STATUS.PENDING]: [REPORT_STATUS.PROCESSING, REPORT_STATUS.PERMANENTLY_FAILED],
  [REPORT_STATUS.PROCESSING]: [
    REPORT_STATUS.COMPLETED,
    REPORT_STATUS.FAILED,
    REPORT_STATUS.PERMANENTLY_FAILED,
  ],
  [REPORT_STATUS.FAILED]: [REPORT_STATUS.PROCESSING, REPORT_STATUS.PERMANENTLY_FAILED],
  [REPORT_STATUS.COMPLETED]: [],
  [REPORT_STATUS.PERMANENTLY_FAILED]: [],
};

/**
 * Check if a status transition is permitted by the state machine.
 */
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Assert that a status transition is permitted, throwing InvalidStateTransitionError if not.
 */
export function assertValidTransition(
  from: ReportStatus,
  to: ReportStatus,
  reportId?: string,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to, reportId);
  }
}
