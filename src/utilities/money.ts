/**
 * Money is always whole Kenyan shillings stored as integers. Never floats.
 */
export type Shillings = number;

export function isShillings(value: unknown): value is Shillings {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertShillings(value: number, label = "amount"): Shillings {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number of shillings, got ${value}`);
  }
  return value;
}

export function assertNonNegativeShillings(value: number, label = "amount"): Shillings {
  assertShillings(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative, got ${value}`);
  return value;
}

/**
 * Parses user or provider input such as "1,500", "KES 1500" or "1500.00".
 * Rejects anything with a non-zero fractional part.
 */
export function parseShillings(input: string | number): Shillings {
  if (typeof input === "number") return assertShillings(input);

  const cleaned = input.replace(/kes|ksh|sh/gi, "").replace(/[\s,]/g, "");
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match || match[1] === undefined) {
    throw new RangeError(`"${input}" is not a valid shilling amount`);
  }
  if (match[2] !== undefined && /[1-9]/.test(match[2])) {
    throw new RangeError(`"${input}" has cents; amounts must be whole shillings`);
  }
  return assertShillings(Number.parseInt(match[1], 10));
}

export function sumShillings(values: readonly Shillings[]): Shillings {
  let total = 0;
  for (const value of values) total += assertShillings(value);
  return assertShillings(total);
}

/** A percentage of an amount, rounded half-up to the nearest shilling. */
export function percentageOf(amount: Shillings, percent: number): Shillings {
  assertShillings(amount);
  if (!Number.isFinite(percent)) throw new RangeError(`percent must be finite, got ${percent}`);
  return Math.round((amount * percent) / 100);
}

/** amount × numerator ÷ denominator, rounded half-up to the nearest shilling. */
export function scaleShillings(amount: Shillings, numerator: number, denominator: number): Shillings {
  assertShillings(amount);
  if (denominator === 0) throw new RangeError("denominator must not be zero");
  return Math.round((amount * numerator) / denominator);
}

/** Formats 15000 as "15,000" (no currency), for compact SMS text. */
export function formatAmount(amount: Shillings): string {
  return formatter.format(amount);
}

const formatter = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

/** Formats 15000 as "KES 15,000" and -200 as "-KES 200". */
export function formatShillings(amount: Shillings): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}KES ${formatter.format(Math.abs(amount))}`;
}
