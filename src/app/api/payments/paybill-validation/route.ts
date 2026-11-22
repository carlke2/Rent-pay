import { NextResponse } from "next/server";
import { hasCallbackKey } from "@/authentication/secrets";
import { isPayableAccount, storeCallback } from "@/services/payments";
import { readCallbackBody, unauthorised } from "../receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPT = { ResultCode: "0", ResultDesc: "Accepted" };
const REJECT = { ResultCode: "C2B00012", ResultDesc: "Rejected" };

/** Must answer fast: store the body and run one indexed lookup in parallel, no queue. */
export async function POST(request: Request) {
  if (!hasCallbackKey(request)) return unauthorised();

  const payload = await readCallbackBody(request);
  const billReference =
    typeof payload === "object" && payload !== null && "BillRefNumber" in payload ? String(payload.BillRefNumber ?? "") : "";

  const [stored, payable] = await Promise.allSettled([
    storeCallback("paybill_validation", payload),
    isPayableAccount(billReference),
  ]);
  if (stored.status === "rejected") console.error("Could not store paybill validation callback", stored.reason);
  if (payable.status === "rejected") {
    // If we can't check, accept: the payment is still recorded (unmatched at worst) rather than bounced.
    console.error("Paybill validation lookup failed", payable.reason);
    return NextResponse.json(ACCEPT);
  }
  return NextResponse.json(payable.value ? ACCEPT : REJECT);
}
