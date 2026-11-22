import { addDays, type IsoDate } from "@/utilities/dates";
import { normaliseUnitCode } from "./unit-code";

export type MatchRule = "stk_request" | "active_lease" | "recently_ended_lease" | "unmatched";

export type MatchResult =
  | { matched: true; leaseId: string; rule: Exclude<MatchRule, "unmatched"> }
  | { matched: false; leaseId: null; rule: "unmatched"; reason: string };

export type LeaseCandidate = {
  leaseId: string;
  unitCode: string;
  status: "active" | "notice" | "ended";
  endDate: IsoDate | null;
};

/** How long after a lease ends a payment for its unit still goes to that lease. */
export const RECENTLY_ENDED_DAYS = 60;

/**
 * The matching ladder. Payments are matched by unit code, never by phone
 * (C2B v2 masks the payer's phone).
 * 1. STK push: the payment request with the same checkout request ID.
 * 2. The current (active or on-notice) lease for the unit code in the account reference.
 * 3. The most recently ended lease for that unit, if it ended within RECENTLY_ENDED_DAYS.
 * 4. Otherwise unmatched, for the landlord to assign.
 */
export function matchPayment(input: {
  checkoutRequestId?: string | null;
  accountReference?: string | null;
  paidOn: IsoDate;
  paymentRequests: readonly { checkoutRequestId: string; leaseId: string }[];
  leases: readonly LeaseCandidate[];
  recentlyEndedDays?: number;
}): MatchResult {
  if (input.checkoutRequestId) {
    const request = input.paymentRequests.find((item) => item.checkoutRequestId === input.checkoutRequestId);
    if (request) return { matched: true, leaseId: request.leaseId, rule: "stk_request" };
  }

  const code = normaliseUnitCode(input.accountReference ?? "");
  if (!code) return { matched: false, leaseId: null, rule: "unmatched", reason: "no account reference" };

  const forUnit = input.leases.filter((lease) => normaliseUnitCode(lease.unitCode) === code);
  if (forUnit.length === 0) {
    return { matched: false, leaseId: null, rule: "unmatched", reason: `no unit with code ${code}` };
  }

  const current = forUnit.filter((lease) => lease.status === "active" || lease.status === "notice");
  if (current.length === 1 && current[0]) return { matched: true, leaseId: current[0].leaseId, rule: "active_lease" };
  if (current.length > 1) {
    return { matched: false, leaseId: null, rule: "unmatched", reason: `more than one current lease for ${code}` };
  }

  const cutoff = addDays(input.paidOn, -(input.recentlyEndedDays ?? RECENTLY_ENDED_DAYS));
  const recentlyEnded = forUnit
    .filter((lease) => lease.status === "ended" && lease.endDate !== null && lease.endDate >= cutoff)
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];
  if (recentlyEnded) return { matched: true, leaseId: recentlyEnded.leaseId, rule: "recently_ended_lease" };

  return { matched: false, leaseId: null, rule: "unmatched", reason: `no current or recent lease for ${code}` };
}
