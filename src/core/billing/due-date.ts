import { addDays, dateInPeriod, type BillingPeriod, type IsoDate } from "@/utilities/dates";

/** The due date for a period: `dueDay` of that month, clamped to the month's length. */
export function dueDateFor(period: BillingPeriod, dueDay: number): IsoDate {
  return dateInPeriod(period, dueDay);
}

/** The last day of grace; penalties and "overdue" start the day after. */
export function graceEndsOn(dueDate: IsoDate, graceDays: number): IsoDate {
  return addDays(dueDate, Math.max(0, graceDays));
}

export function isPastGrace(today: IsoDate, dueDate: IsoDate, graceDays: number): boolean {
  return today > graceEndsOn(dueDate, graceDays);
}
