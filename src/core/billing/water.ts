import { assertNonNegativeShillings, type Shillings } from "@/utilities/money";

export type ReadingFlag = "lower_than_previous" | "unusually_high";

export type ReadingAssessment = {
  consumption: number;
  flags: ReadingFlag[];
  flagged: boolean;
  /** Average of up to the last 3 consumptions, or null with no history. */
  recentAverage: number | null;
};

/** A reading is unusually high above this multiple of the recent average. */
export const HIGH_READING_MULTIPLIER = 3;

/**
 * Checks a meter reading.
 * - lower_than_previous: the current reading is below last month's reading.
 * - unusually_high: consumption is more than 3× the average of the last 3 months.
 * `recentConsumptions` lists earlier months' consumption, most recent first.
 */
export function assessReading(input: {
  previousReading: number;
  currentReading: number;
  recentConsumptions: readonly number[];
}): ReadingAssessment {
  const flags: ReadingFlag[] = [];
  const consumption = input.currentReading - input.previousReading;
  if (consumption < 0) flags.push("lower_than_previous");

  const history = input.recentConsumptions.slice(0, 3).filter((value) => value >= 0);
  const recentAverage = history.length > 0 ? history.reduce((sum, value) => sum + value, 0) / history.length : null;
  if (recentAverage !== null && recentAverage > 0 && consumption > HIGH_READING_MULTIPLIER * recentAverage) {
    flags.push("unusually_high");
  }

  return { consumption: Math.max(0, consumption), flags, flagged: flags.length > 0, recentAverage };
}

export type WaterCharge = {
  consumption: number;
  ratePerUnit: Shillings;
  usageAmount: Shillings;
  standingCharge: Shillings;
  total: Shillings;
};

export function waterCharge(input: {
  consumption: number;
  ratePerUnit: Shillings;
  standingCharge: Shillings;
}): WaterCharge {
  if (!Number.isInteger(input.consumption) || input.consumption < 0) {
    throw new RangeError(`consumption must be a non-negative whole number, got ${input.consumption}`);
  }
  assertNonNegativeShillings(input.ratePerUnit, "ratePerUnit");
  assertNonNegativeShillings(input.standingCharge, "standingCharge");
  const usageAmount = input.consumption * input.ratePerUnit;
  return {
    consumption: input.consumption,
    ratePerUnit: input.ratePerUnit,
    usageAmount,
    standingCharge: input.standingCharge,
    total: usageAmount + input.standingCharge,
  };
}
