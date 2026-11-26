import "server-only";
import { getEnvironment } from "@/configuration/environment";
import { mpesaTimestamp } from "@/utilities/dates";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { darajaPost } from "./client";
import type {
  RegisterUrlRequest,
  RegisterUrlResponse,
  SimulateRequest,
  SimulateResponse,
  StkPushRequest,
  StkPushResponse,
  StkStatusRequest,
  StkStatusResponse,
} from "./types";

export { DarajaError } from "./client";
export * from "./types";

/** Daraja sandbox test phone number. */
export const SANDBOX_TEST_PHONE = "254708374149";

/** Words Daraja rejects in callback URLs (any case). */
const FORBIDDEN_URL_WORDS = ["mpesa", "safaricom", "query", "exe", "exec", "cmd", "sql"];

/** Returns 2547XXXXXXXX / 2541XXXXXXXX, or throws. */
export function normalisePhone(input: string): string {
  const phone = normaliseKenyanPhone(input);
  if (!phone) throw new Error(`"${input}" is not a valid Kenyan mobile number`);
  return phone;
}

/**
 * Builds one of our callback URLs and refuses any path Daraja would reject.
 * STK keeps the key in ?key=. Paybill URLs carry it as the last path segment, because the Daraja sandbox drops
 * the query string from registered C2B URLs.
 */
export function callbackUrl(path: "stk-result" | "paybill-validation" | "paybill-confirmation"): string {
  const { APP_URL, MPESA_CALLBACK_KEY } = getEnvironment();
  const url = `${APP_URL.replace(/\/+$/, "")}/api/payments/${path}`;
  const lowered = url.toLowerCase();
  const word = FORBIDDEN_URL_WORDS.find((forbidden) => lowered.includes(forbidden));
  if (word) throw new Error(`Callback URL ${url} contains "${word}", which Daraja rejects`);
  if (path === "stk-result") return `${url}?key=${encodeURIComponent(MPESA_CALLBACK_KEY)}`;
  const keyWord = FORBIDDEN_URL_WORDS.find((forbidden) => MPESA_CALLBACK_KEY.toLowerCase().includes(forbidden));
  if (keyWord) throw new Error(`MPESA_CALLBACK_KEY contains "${keyWord}", which Daraja rejects in URLs: choose another key`);
  return `${url}/${encodeURIComponent(MPESA_CALLBACK_KEY)}`;
}

function stkPassword(timestamp: string): string {
  const { MPESA_STK_SHORTCODE, MPESA_STK_PASSKEY } = getEnvironment();
  return Buffer.from(`${MPESA_STK_SHORTCODE}${MPESA_STK_PASSKEY}${timestamp}`).toString("base64");
}

function wholeAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError(`amount must be a whole number of at least 1, got ${amount}`);
  return amount;
}

export async function stkPush(input: {
  phone: string;
  amount: number;
  accountReference: string;
  description?: string;
}): Promise<{ merchantRequestId: string; checkoutRequestId: string; customerMessage: string }> {
  const { MPESA_STK_SHORTCODE } = getEnvironment();
  const phone = normalisePhone(input.phone);
  const timestamp = mpesaTimestamp();
  const request: StkPushRequest = {
    BusinessShortCode: MPESA_STK_SHORTCODE,
    Password: stkPassword(timestamp),
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: wholeAmount(input.amount),
    PartyA: phone,
    PartyB: MPESA_STK_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: callbackUrl("stk-result"),
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: (input.description ?? "Rent").slice(0, 13),
  };
  const response = await darajaPost<StkPushResponse>("/mpesa/stkpush/v1/processrequest", request);
  return {
    merchantRequestId: response.MerchantRequestID,
    checkoutRequestId: response.CheckoutRequestID,
    customerMessage: response.CustomerMessage,
  };
}

/** Daraja error code returned while the customer hasn't finished the prompt yet. */
export const STK_STILL_PROCESSING_ERROR_CODE = "500.001.1001";

export async function stkStatus(checkoutRequestId: string): Promise<{ resultCode: number; resultDescription: string }> {
  const { MPESA_STK_SHORTCODE } = getEnvironment();
  const timestamp = mpesaTimestamp();
  const request: StkStatusRequest = {
    BusinessShortCode: MPESA_STK_SHORTCODE,
    Password: stkPassword(timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };
  const response = await darajaPost<StkStatusResponse>("/mpesa/stkpushquery/v1/query", request);
  return { resultCode: Number(response.ResultCode), resultDescription: response.ResultDesc };
}

export async function registerPaybillUrls(): Promise<RegisterUrlResponse> {
  const request: RegisterUrlRequest = {
    ShortCode: getEnvironment().MPESA_SHORTCODE,
    ResponseType: "Completed",
    ConfirmationURL: callbackUrl("paybill-confirmation"),
    ValidationURL: callbackUrl("paybill-validation"),
  };
  return darajaPost<RegisterUrlResponse>("/mpesa/c2b/v2/registerurl", request);
}

/** Sandbox only: makes Daraja send us a Paybill payment from the test number. */
export async function simulatePaybill(input: { amount: number; billReference: string }): Promise<SimulateResponse> {
  const environment = getEnvironment();
  if (environment.MPESA_ENV !== "sandbox") throw new Error("Paybill simulation only works in the sandbox");
  const request: SimulateRequest = {
    ShortCode: environment.MPESA_SHORTCODE,
    CommandID: "CustomerPayBillOnline",
    Amount: wholeAmount(input.amount),
    Msisdn: SANDBOX_TEST_PHONE,
    BillRefNumber: input.billReference,
  };
  return darajaPost<SimulateResponse>("/mpesa/c2b/v2/simulate", request);
}
