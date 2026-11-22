import "server-only";
import { randomUUID } from "node:crypto";
import { getEnvironment } from "@/configuration/environment";
import { maskPhone } from "@/utilities/phone";
import type { SmsSender } from "./types";

/**
 * Development sender: prints messages to the terminal (that's how you read login codes locally).
 * In production it never prints the text or the full number: messages can contain login codes.
 */
export const consoleSms: SmsSender = {
  async send(to, message) {
    if (getEnvironment().NODE_ENV === "production") console.info(`[sms:console] to ${maskPhone(to)}: (${message.length} characters, hidden in production)`);
    else console.info(`[sms:console] to ${to}: ${message}`);
    return { providerId: `console-${randomUUID()}`, status: "sent", cost: null };
  },
};
