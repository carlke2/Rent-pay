import "server-only";
import { randomUUID } from "node:crypto";
import type { SmsSender } from "./types";

/** Development sender: prints messages to the terminal. */
export const consoleSms: SmsSender = {
  async send(to, message) {
    console.info(`[sms:console] to ${to}: ${message}`);
    return { providerId: `console-${randomUUID()}`, status: "sent", cost: null };
  },
};
