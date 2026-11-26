import { NextResponse } from "next/server";
import { hasCallbackKey } from "@/authentication/secrets";
import { storeCallback } from "@/services/payments";
import { parseShillings } from "@/utilities/money";
import { readCallbackBody, unauthorised } from "../receive";
import { logError } from "@/utilities/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Accepts every payment with a valid amount, whatever the account number, so money never bounces back to the
 * payer. A wrong account is recorded as unmatched by the confirmation callback for the landlord to assign.
 * Must answer fast: no lookups, and storing the body is best effort.
 */
export async function POST(request: Request) {
  if (!hasCallbackKey(request)) return unauthorised();

  const payload = await readCallbackBody(request);
  const amount = typeof payload === "object" && payload !== null && "TransAmount" in payload ? payload.TransAmount : undefined;

  try {
    await storeCallback("paybill_validation", payload);
  } catch (error) {
    logError("Could not store paybill validation callback", error);
  }
  return NextResponse.json(isValidAmount(amount) ? ACCEPT : REJECT_AMOUNT);
}
