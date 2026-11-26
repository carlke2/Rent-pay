import "server-only";
import { NextResponse } from "next/server";
import { checkCallbackKey } from "@/authentication/secrets";
import { storeCallback } from "@/services/payments";
import { logError } from "@/utilities/log";
import { parseShillings } from "@/utilities/money";
import { readCallbackBody, receiveCallback, unauthorised } from "./receive";

/**
 * Paybill (C2B) handlers shared by /api/payments/paybill-*?key=… and /api/payments/paybill-*\/{key}.
 * The path form exists because the Daraja sandbox drops the query string from registered C2B URLs.
 */

const ACCEPT = { ResultCode: "0", ResultDesc: "Accepted" };
/** Daraja's code for an invalid amount: the only reason we ever refuse a Paybill payment. */
const REJECT_AMOUNT = { ResultCode: "C2B00013", ResultDesc: "Rejected: invalid amount" };

/** A whole number of shillings, at least 1. */
function isValidAmount(value: unknown): boolean {
  try {
    return parseShillings(String(value ?? "")) >= 1;
  } catch {
    return false;
  }
}

/** A completed Paybill payment: stored, then processed in the background. */
export function paybillConfirmation(request: Request, pathKey?: string) {
  return receiveCallback(request, "paybill_confirmation", { ResultCode: 0, ResultDesc: "Success" }, pathKey);
}

/**
 * Accepts every payment with a valid amount, whatever the account number, so money never bounces back to the
 * payer. A wrong account is recorded as unmatched by the confirmation callback for the landlord to assign.
 * Must answer fast: no lookups, and storing the body is best effort.
 */
export async function paybillValidation(request: Request, pathKey?: string) {
  const key = checkCallbackKey(request, pathKey);
  if (!key.ok) return unauthorised("paybill_validation", key.reason);

  const payload = await readCallbackBody(request);
  const amount = typeof payload === "object" && payload !== null && "TransAmount" in payload ? payload.TransAmount : undefined;

  try {
    await storeCallback("paybill_validation", payload);
  } catch (error) {
    logError("Could not store paybill validation callback", error);
  }
  return NextResponse.json(isValidAmount(amount) ? ACCEPT : REJECT_AMOUNT);
}
