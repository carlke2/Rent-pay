/**
 * Business dates use Africa/Nairobi (UTC+3, no daylight saving).
 * Dates are "YYYY-MM-DD" strings; billing periods are "YYYY-MM" strings.
 * Calendar arithmetic works on those strings, so it never depends on the server's time zone.
 */
export const NAIROBI_TIME_ZONE = "Africa/Nairobi";
const NAIROBI_OFFSET_MILLISECONDS = 3 * 60 * 60 * 1000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" */
export type IsoDate = string;
/** "YYYY-MM" */
export type BillingPeriod = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(`${pad(year, 4)}-${pad(month)}`);
}

export function isBillingPeriod(value: string): value is BillingPeriod {
  const match = PERIOD_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`"${value}" is not a valid YYYY-MM-DD date`);
  return value;
}

export function assertBillingPeriod(value: string): BillingPeriod {
  if (!isBillingPeriod(value)) throw new RangeError(`"${value}" is not a valid YYYY-MM period`);
  return value;
}

type NairobiParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock parts of an instant in Nairobi. */
export function nairobiParts(instant: Date = new Date()): NairobiParts {
  const shifted = new Date(instant.getTime() + NAIROBI_OFFSET_MILLISECONDS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Today's date in Nairobi. */
export function todayInNairobi(instant: Date = new Date()): IsoDate {
  const { year, month, day } = nairobiParts(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The Nairobi date an instant falls on. */
export function toNairobiDate(instant: Date): IsoDate {
  return todayInNairobi(instant);
}

/** The current billing period in Nairobi. */
export function currentPeriod(instant: Date = new Date()): BillingPeriod {
  return periodOf(todayInNairobi(instant));
}

/** M-Pesa Daraja timestamp YYYYMMDDHHmmss in Nairobi time. */
export function mpesaTimestamp(instant: Date = new Date()): string {
  const p = nairobiParts(instant);
  return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
}

/** Parses an M-Pesa YYYYMMDDHHmmss (Nairobi) timestamp into an instant. */
export function parseMpesaTimestamp(value: string | number): Date {
  const text = String(value);
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!match) throw new RangeError(`"${text}" is not a YYYYMMDDHHmmss timestamp`);
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[] as [
    number, number, number, number, number, number, number,
  ];
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - NAIROBI_OFFSET_MILLISECONDS);
}

/** The instant a Nairobi date starts (00:00 Nairobi). */
export function startOfNairobiDay(date: IsoDate): Date {
  return new Date(toEpochDay(date) * DAY_MILLISECONDS - NAIROBI_OFFSET_MILLISECONDS);
}

// ---- calendar arithmetic on strings ----

function toEpochDay(date: IsoDate): number {
  const match = ISO_DATE_PATTERN.exec(assertIsoDate(date));
  const [, year, month, day] = (match as RegExpExecArray).map(Number) as [number, number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MILLISECONDS;
}

function fromEpochDay(epochDay: number): IsoDate {
  const date = new Date(epochDay * DAY_MILLISECONDS);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function earlierDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function laterDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

export function periodOf(date: IsoDate): BillingPeriod {
  return assertIsoDate(date).slice(0, 7);
}

function periodParts(period: BillingPeriod): [number, number] {
  const match = PERIOD_PATTERN.exec(assertBillingPeriod(period)) as RegExpExecArray;
  return [Number(match[1]), Number(match[2])];
}

export function daysInMonth(period: BillingPeriod): number {
  const [year, month] = periodParts(period);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function firstDayOfPeriod(period: BillingPeriod): IsoDate {
  return `${period}-01`;
}

export function lastDayOfPeriod(period: BillingPeriod): IsoDate {
  return `${period}-${pad(daysInMonth(period))}`;
}

/** A day within a period, clamped to the month's length (day 31 in February → the 28th/29th). */
export function dateInPeriod(period: BillingPeriod, day: number): IsoDate {
  const clamped = Math.min(Math.max(1, Math.trunc(day)), daysInMonth(period));
  return `${period}-${pad(clamped)}`;
}

export function addMonthsToPeriod(period: BillingPeriod, months: number): BillingPeriod {
  const [year, month] = periodParts(period);
  const index = year * 12 + (month - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** Same day of month `months` later, clamped to the month's length. */
export function addMonthsToDate(date: IsoDate, months: number): IsoDate {
  const day = Number(assertIsoDate(date).slice(8, 10));
  return dateInPeriod(addMonthsToPeriod(periodOf(date), months), day);
}

/** Formats "2026-11-05" as "5 Nov 2026". */
export function formatDate(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(toEpochDay(date) * DAY_MILLISECONDS),
  );
}

/** Formats "2026-11" as "November 2026". */
export function formatPeriod(period: BillingPeriod): string {
  return new Intl.DateTimeFormat("en-KE", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(toEpochDay(firstDayOfPeriod(period)) * DAY_MILLISECONDS),
  );
}

/** Formats an instant as Nairobi time, e.g. "18 Nov 2026, 14:05". */
export function formatNairobiDateTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: NAIROBI_TIME_ZONE,
  }).format(instant);
}
