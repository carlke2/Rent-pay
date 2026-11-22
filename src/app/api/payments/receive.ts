import "server-only";
import { NextResponse } from "next/server";
import { hasCallbackKey } from "@/authentication/secrets";
import { queueJob } from "@/services/jobs";
import { storeCallback, type CallbackKind } from "@/services/payments";

/** Reads a callback body; anything that isn't JSON is kept as text so nothing is lost. */
export async function readCallbackBody(request: Request): Promise<unknown> {
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return { unparsed: text };
  }
}

export function unauthorised() {
  return NextResponse.json({ ResultCode: 1, ResultDesc: "Unauthorised" }, { status: 401 });
}

/**
 * Shared flow for stk-result and paybill-confirmation:
 * check the key, store the raw body, queue processing, reply at once.
 */
export async function receiveCallback(request: Request, kind: Exclude<CallbackKind, "paybill_validation">, reply: object) {
  if (!hasCallbackKey(request)) return unauthorised();

  const payload = await readCallbackBody(request);
  let callbackId: string;
  try {
    callbackId = await storeCallback(kind, payload);
  } catch (error) {
    console.error(`Could not store ${kind} callback`, error);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }

  try {
    await queueJob("process-payment", { callbackId });
  } catch (error) {
    // Stored safely; it can be reprocessed from payment_callbacks.
    console.error(`Could not queue ${kind} callback ${callbackId}`, error);
  }
  return NextResponse.json(reply);
}
