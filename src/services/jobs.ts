import "server-only";
import { z } from "zod";
import { publishToQstash, runAfterResponse } from "@/adapters/queue";
import { getEnvironment } from "@/configuration/environment";
import { isBillingPeriod, isIsoDate, periodOf, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { applyPenalties, generateInvoices } from "./billing";
import { sendDailySummary, sendInvoice, sendPenaltyNotice, sendReminders } from "./notifications";
import { checkPendingStkRequests, processCallback } from "./payments";

const datedPayload = z.object({
  today: z.string().refine(isIsoDate, "today must be YYYY-MM-DD").optional(),
});

/** Maps job names (also their /api/jobs/<name> routes) to service functions. */
const registry = {
  "process-payment": async (payload: unknown) => {
    const { callbackId } = z.object({ callbackId: z.uuid() }).parse(payload);
    return processCallback(callbackId);
  },
  "check-stk-status": async () => checkPendingStkRequests(),
  "generate-invoices": async (payload: unknown) => {
    const { today, period, force } = datedPayload
      .extend({ period: z.string().refine(isBillingPeriod, "period must be YYYY-MM").optional(), force: z.boolean().optional() })
      .parse(payload ?? {});
    const day: IsoDate = today ?? todayInNairobi();
    // Scheduled runs bill only on the 1st; an explicit period always runs.
    if (!period && !force && !day.endsWith("-01")) {
      return { skipped: true, reason: `Invoices are generated on the 1st (today is ${day}); pass a period to run now` };
    }
    return generateInvoices({ period: period ?? periodOf(day), today: day });
  },
  "apply-penalties": async (payload: unknown) => applyPenalties({ today: datedPayload.parse(payload ?? {}).today }),
  "send-reminders": async (payload: unknown) => sendReminders({ today: datedPayload.parse(payload ?? {}).today }),
  "daily-summary": async (payload: unknown) => sendDailySummary({ today: datedPayload.parse(payload ?? {}).today }),
  "send-notification": async (payload: unknown) => {
    const { kind, id } = z.object({ kind: z.enum(["invoice", "penalty"]), id: z.uuid() }).parse(payload);
    return kind === "invoice" ? sendInvoice(id) : sendPenaltyNotice(id);
  },
} satisfies Record<string, (payload: unknown) => Promise<unknown>>;

export type JobName = keyof typeof registry;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(registry, name);
}

export async function runJob(name: JobName, payload: unknown): Promise<unknown> {
  return registry[name](payload);
}

/**
 * Queues a job. inline: runs after the response is sent (Next.js after()).
 * qstash: published to QStash, which calls /api/jobs/<name> and retries on failure.
 */
export async function queueJob(name: JobName, payload: unknown): Promise<void> {
  if (getEnvironment().QUEUE_PROVIDER === "qstash") {
    await publishToQstash(name, payload);
    return;
  }
  runAfterResponse(() => runJob(name, payload), name);
}
