import "server-only";
import { getEnvironment } from "@/configuration/environment";
import type { SmsSender } from "./types";

type AdvantaRecipient = {
  "response-code"?: number;
  "respose-code"?: number;
  "response-description"?: string;
  mobile?: string | number;
  messageid?: string | number;
};

type AdvantaResponse = {
  responses?: AdvantaRecipient[];
  "response-code"?: number;
  "respose-code"?: number;
  "response-description"?: string;
};

function responseCode(row: AdvantaRecipient | AdvantaResponse): number | undefined {
  return row["response-code"] ?? row["respose-code"];
}

/** Advanta Africa (quicksms.advantasms.com) SMS sender. */
export const advantaSms: SmsSender = {
  async send(to, message) {
    const { ADVANTA_SMS_URL, ADVANTA_API_KEY, ADVANTA_PARTNER_ID, ADVANTA_SHORTCODE } = getEnvironment();
    if (!ADVANTA_API_KEY || !ADVANTA_PARTNER_ID || !ADVANTA_SHORTCODE) {
      throw new Error("Set ADVANTA_API_KEY, ADVANTA_PARTNER_ID and ADVANTA_SHORTCODE to send SMS");
    }

    const url = ADVANTA_SMS_URL ?? "https://quicksms.advantasms.com/api/services/sendsms/";
    const mobile = to.replace(/^\+/, "");
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: ADVANTA_API_KEY,
        partnerID: ADVANTA_PARTNER_ID,
        message,
        shortcode: ADVANTA_SHORTCODE,
        mobile,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const text = await response.text();
    let body: AdvantaResponse;
    try {
      body = JSON.parse(text) as AdvantaResponse;
    } catch {
      throw new Error(`Advanta SMS: HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    const recipient = body.responses?.[0];
    const code = recipient ? responseCode(recipient) : responseCode(body);
    if (code === undefined) {
      throw new Error(`Advanta SMS: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    if (code !== 200) {
      const description = recipient?.["response-description"] ?? body["response-description"] ?? "failed";
      throw new Error(`Advanta SMS: ${code} ${description}`);
    }

    const messageId = recipient?.messageid;
    return {
      providerId: messageId !== undefined && messageId !== null ? String(messageId) : null,
      status: "sent",
      cost: null,
    };
  },
};
