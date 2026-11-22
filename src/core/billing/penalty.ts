import type { PenaltySettings } from "@/core/policy";
import { periodOf, type IsoDate } from "@/utilities/dates";
import { assertShillings, percentageOf, type Shillings } from "@/utilities/money";

export type PenaltyDecision =
  | { apply: true; amount: Shillings; description: string }
  | { apply: false; reason: "disabled" | "within_grace" | "nothing_overdue" | "already_applied" | "zero_amount" };

/**
 * Whether a late-payment penalty is due today, and how much.
 * - Applies only after the grace period ends and while something is overdue.
 * - "once": at most one penalty per invoice. "monthly": at most one per invoice per period (calendar month).
 */
export function decidePenalty(input: {
  settings: PenaltySettings;
  overdueAmount: Shillings;
  graceEndsOn: IsoDate;
  today: IsoDate;
  /** Dates penalties were already added to this invoice. */
  appliedOn: readonly IsoDate[];
}): PenaltyDecision {
  const { settings, today } = input;
  assertShillings(input.overdueAmount, "overdueAmount");

  if (settings.type === "none") return { apply: false, reason: "disabled" };
  if (today <= input.graceEndsOn) return { apply: false, reason: "within_grace" };
  if (input.overdueAmount <= 0) return { apply: false, reason: "nothing_overdue" };

  if (input.appliedOn.length > 0) {
    if (settings.repeat === "once") return { apply: false, reason: "already_applied" };
    const currentPeriod = periodOf(today);
    if (input.appliedOn.some((date) => periodOf(date) === currentPeriod)) return { apply: false, reason: "already_applied" };
  }

  const amount = settings.type === "flat" ? settings.amount : percentageOf(input.overdueAmount, settings.percent);
  if (amount <= 0) return { apply: false, reason: "zero_amount" };

  const description =
    settings.type === "flat" ? "Late payment penalty" : `Late payment penalty (${settings.percent}% of overdue balance)`;
  return { apply: true, amount, description };
}
