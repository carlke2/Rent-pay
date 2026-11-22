import { policySettingsSchema, type PolicySettings } from "./types";

export const DEFAULT_POLICY_SETTINGS: PolicySettings = {
  dueDay: 5,
  graceDays: 5,
  penalty: { type: "none", amount: 0, percent: 0, repeat: "once" },
  water: { ratePerUnit: 0, standingCharge: 0 },
  fixedCharges: [],
  prorate: true,
  allocationOrder: ["rent", "water", "fixed", "penalty", "other"],
  reminders: { daysBeforeDue: 2, daysAfterGrace: 1, repeatEveryDays: 7 },
  overpayment: "credit",
};

type PlainObject = Record<string, unknown>;
const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function deepMerge(base: PlainObject, override: PlainObject): PlainObject {
  const result: PlainObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return result;
}

/** Applies a partial change (e.g. { water: { ratePerUnit: 150 } }) on top of full settings and validates the result. */
export function mergePolicySettings(base: PolicySettings, change: unknown): PolicySettings {
  const merged = isPlainObject(change) ? deepMerge(base as unknown as PlainObject, change) : base;
  return policySettingsSchema.parse(merged);
}

/**
 * Fills missing keys from the defaults (so settings saved by older versions keep working)
 * and validates the result. Throws if stored values are invalid.
 */
export function completePolicySettings(stored: unknown): PolicySettings {
  const merged = isPlainObject(stored)
    ? deepMerge(DEFAULT_POLICY_SETTINGS as unknown as PlainObject, stored)
    : DEFAULT_POLICY_SETTINGS;
  return policySettingsSchema.parse(merged);
}
