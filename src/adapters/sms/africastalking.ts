import "server-only";
import { getEnvironment } from "@/configuration/environment";
import type { SmsSender } from "./types";

type AfricasTalkingResponse = {
  SMSMessageData?: {
    Message?: string;
    Recipients?: { statusCode: number; number: string; status: string; cost: string; messageId: string }[];
  };
};

/** Status codes meaning the message was accepted: 100 processed, 101 sent, 102 queued. */
const ACCEPTED_STATUS_CODES = new Set([100, 101, 102]);

export const africasTalkingSms: SmsSender = {
  async send(to, message) {
    const { AT_USERNAME, AT_API_KEY, AT_SENDER_ID } = getEnvironment();
    if (!AT_USERNAME || !AT_API_KEY) throw new Error("Set AT_USERNAME and AT_API_KEY to send SMS");

    const url =
      AT_USERNAME === "sandbox"
        ? "https://api.sandbox.africastalking.com/version1/messaging"
        : "https://api.africastalking.com/version1/messaging";
    const form = new URLSearchParams({ username: AT_USERNAME, to: `+${to.replace(/^\+/, "")}`, message });
    if (AT_SENDER_ID) form.set("from", AT_SENDER_ID);

    const response = await fetch(url, {
      method: "POST",
      headers: { apiKey: AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Africa's Talking: HTTP ${response.status} ${text.slice(0, 200)}`);

    let body: AfricasTalkingResponse;
    try {
      body = JSON.parse(text) as AfricasTalkingResponse;
    } catch {
      throw new Error(`Africa's Talking: unexpected response ${text.slice(0, 200)}`);
    }
    const recipient = body.SMSMessageData?.Recipients?.[0];
    if (!recipient) throw new Error(`Africa's Talking: ${body.SMSMessageData?.Message ?? "no recipients in response"}`);

    return {
      providerId: recipient.messageId && recipient.messageId !== "None" ? recipient.messageId : null,
      status: ACCEPTED_STATUS_CODES.has(recipient.statusCode) ? "sent" : "failed",
      cost: recipient.cost ?? null,
    };
  },
};
