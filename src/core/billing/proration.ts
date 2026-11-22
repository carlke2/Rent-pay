import { assertNonNegativeShillings, scaleShillings, type Shillings } from "@/utilities/money";
import {
  daysBetween,
  daysInMonth,
  earlierDate,
  firstDayOfPeriod,
  lastDayOfPeriod,
  laterDate,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";

export type ProrationInput = {
  monthlyRent: Shillings;
  period: BillingPeriod;
  /** Lease start date. */
  occupiedFrom: IsoDate;
  /** Lease end date (inclusive), if any. */
  occupiedTo?: IsoDate | null;
  prorate: boolean;
};

export type ProrationResult = {
  amount: Shillings;
  daysOccupied: number;
  daysInPeriod: number;
  prorated: boolean;
};

/**
 * Rent for a period, prorated by days occupied when the lease starts or ends inside the period.
 * With proration off, any occupancy in the period is charged the full month.
 */
export function prorateRent(input: ProrationInput): ProrationResult {
  assertNonNegativeShillings(input.monthlyRent, "monthlyRent");
  const periodStart = firstDayOfPeriod(input.period);
  const periodEnd = lastDayOfPeriod(input.period);
  const totalDays = daysInMonth(input.period);

  const from = laterDate(periodStart, input.occupiedFrom);
  const to = input.occupiedTo ? earlierDate(periodEnd, input.occupiedTo) : periodEnd;
  const daysOccupied = from > to ? 0 : daysBetween(from, to) + 1;

  if (daysOccupied === 0) return { amount: 0, daysOccupied, daysInPeriod: totalDays, prorated: false };
  if (daysOccupied === totalDays || !input.prorate) {
    return { amount: input.monthlyRent, daysOccupied, daysInPeriod: totalDays, prorated: false };
  }
  return {
    amount: scaleShillings(input.monthlyRent, daysOccupied, totalDays),
    daysOccupied,
    daysInPeriod: totalDays,
    prorated: true,
  };
}
