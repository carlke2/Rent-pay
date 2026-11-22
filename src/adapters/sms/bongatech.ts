import "server-only";
import { getEnvironment } from "@/configuration/environment";
import type { SmsSender } from "./types";

type BongaResponse = {
  status?: boolean;
  message?: string;
  data?: {
    correlator?: string | number;
    uniqueId?: string;
    phone?: string;
    sms_units?: number;
  };
};

/** BongaTech bulk.bongatech.co.ke SMS sender (Bearer token API). */
export const bongaTechSms: SmsSender = {
  async send(to, message) {
    const { BONGATECH_API_URL, BONGATECH_API_KEY, BONGATECH_SENDER_ID, BONGATECH_AUTH_HEADER } = getEnvironment();
    if (!BONGATECH_API_KEY || !BONGATECH_SENDER_ID) {
      throw new Error("Set BONGATECH_API_KEY and BONGATECH_SENDER_ID to send SMS");
    }

    const url = BONGATECH_API_URL ?? "https://bulk.bongatech.co.ke/api/v1/send-sms";
    const phone = to.replace(/^\+/, "");
    const authorization = BONGATECH_AUTH_HEADER?.trim() || `Bearer ${BONGATECH_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        sender: BONGATECH_SENDER_ID,
        message,
        phone,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const text = await response.text();
    let body: BongaResponse;
    try {
      body = JSON.parse(text) as BongaResponse;
    } catch {
      throw new Error(`BongaTech SMS: HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    if (!response.ok || body.status !== true) {
      throw new Error(`BongaTech SMS: HTTP ${response.status} ${body.message ?? text.slice(0, 200)}`);
    }

    return {
      providerId: body.data?.uniqueId ?? (body.data?.correlator !== undefined ? String(body.data.correlator) : null),
      status: "sent",
      cost: body.data?.sms_units !== undefined ? String(body.data.sms_units) : null,
    };
  },
};
