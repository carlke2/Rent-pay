import "server-only";
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    /** e.g. "landlord:<id>", "tenant:<id>", "system:<job>" */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_log_entity_index").on(table.entity, table.entityId)],
).enableRLS();
