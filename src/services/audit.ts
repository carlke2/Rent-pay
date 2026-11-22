import "server-only";
import type { Executor } from "@/database/client";
import { auditLog } from "@/database/schema";

/** Every manual change writes one of these. */
export async function writeAudit(
  database: Executor,
  entry: { actor: string; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; reason?: string | null },
): Promise<void> {
  await database.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}
