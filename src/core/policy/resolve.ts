import type { IsoDate } from "@/utilities/dates";
import { completePolicySettings, DEFAULT_POLICY_SETTINGS } from "./defaults";
import type { PolicyRecord, PolicySettings } from "./types";

export type ResolvedPolicy = {
  settings: PolicySettings;
  policyId: string | null;
  source: "building" | "account" | "default";
  effectiveFrom: IsoDate | null;
};

function latestOnOrBefore(policies: readonly PolicyRecord[], onDate: IsoDate): PolicyRecord | undefined {
  let best: PolicyRecord | undefined;
  for (const policy of policies) {
    if (policy.effectiveFrom > onDate) continue;
    // ">=" so that, for equal dates, the later row in the list (the newer one) wins.
    if (!best || policy.effectiveFrom >= best.effectiveFrom) best = policy;
  }
  return best;
}

/**
 * Which policy applies to a building on a date:
 * the building's latest policy effective on or before the date, else the account's, else defaults.
 * Pass rows oldest-created first so a newer row wins over an older one with the same date.
 */
export function resolvePolicy(
  policies: readonly PolicyRecord[],
  { buildingId, onDate }: { buildingId: string | null; onDate: IsoDate },
): ResolvedPolicy {
  const buildingPolicy = buildingId
    ? latestOnOrBefore(
        policies.filter((policy) => policy.buildingId === buildingId),
        onDate,
      )
    : undefined;
  if (buildingPolicy) {
    return {
      settings: completePolicySettings(buildingPolicy.settings),
      policyId: buildingPolicy.id,
      source: "building",
      effectiveFrom: buildingPolicy.effectiveFrom,
    };
  }

  const accountPolicy = latestOnOrBefore(
    policies.filter((policy) => policy.buildingId === null),
    onDate,
  );
  if (accountPolicy) {
    return {
      settings: completePolicySettings(accountPolicy.settings),
      policyId: accountPolicy.id,
      source: "account",
      effectiveFrom: accountPolicy.effectiveFrom,
    };
  }

  return { settings: DEFAULT_POLICY_SETTINGS, policyId: null, source: "default", effectiveFrom: null };
}
