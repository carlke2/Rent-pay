import type { IsoDate } from "@/utilities/dates";
import type { Shillings } from "@/utilities/money";

export const UNIT_PAYMENT_STATUSES = ["paid", "partial", "unpaid", "overdue", "vacant"] as const;
export type UnitPaymentStatus = (typeof UNIT_PAYMENT_STATUSES)[number];

/**
 * A unit's payment status for the dashboard.
 * vacant: no current lease. paid: nothing owed. overdue: owing after grace ends.
 * partial: owing but something was paid this period. unpaid: owing and nothing paid yet.
 */
export function unitPaymentStatus(input: {
  hasCurrentLease: boolean;
  balance: Shillings;
  paidThisPeriod: Shillings;
  today: IsoDate;
  /** Last day of grace for the oldest invoice that still has an unpaid amount, if any. */
  graceEndsOn: IsoDate | null;
}): UnitPaymentStatus {
  if (!input.hasCurrentLease) return "vacant";
  if (input.balance <= 0) return "paid";
  if (input.graceEndsOn !== null && input.today > input.graceEndsOn) return "overdue";
  if (input.paidThisPeriod > 0) return "partial";
  return "unpaid";
}
