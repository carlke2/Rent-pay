import "server-only";
import { after } from "next/server";
import { getEnvironment } from "@/configuration/environment";
import { logError } from "@/utilities/log";

/**
 * Runs a task after the response has been sent (QUEUE_PROVIDER=inline).
 * Only valid inside a route handler or server action.
 */
export function runAfterResponse(task: () => Promise<unknown>, label: string): void {
  after(async () => {
    try {
      await task();
    } catch (error) {
      logError(`[queue:inline] ${label} failed`, error);
    }
  });
}

/**
 * Publishes a job to QStash (QUEUE_PROVIDER=qstash). QStash calls ${APP_URL}/api/jobs/${name}
 * with the payload as JSON and forwards our CRON_SECRET bearer token, retrying on non-2xx.
 */
export async function publishToQstash(name: string, payload: unknown): Promise<{ messageId: string | null }> {
  const { QSTASH_URL, QSTASH_TOKEN, APP_URL, CRON_SECRET } = getEnvironment();
  if (!QSTASH_TOKEN) throw new Error("Set QSTASH_TOKEN to use QUEUE_PROVIDER=qstash");

  const destination = `${APP_URL.replace(/\/+$/, "")}/api/jobs/${name}`;
  const response = await fetch(`${QSTASH_URL.replace(/\/+$/, "")}/v2/publish/${destination}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
      "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`QStash publish failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  try {
    return { messageId: (JSON.parse(text) as { messageId?: string }).messageId ?? null };
  } catch {
    return { messageId: null };
  }
}
