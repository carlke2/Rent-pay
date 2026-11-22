import "server-only";
import { date, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { PolicySettings } from "../../core/policy/types";
import { createdAt, id } from "./columns";
import { buildings } from "./property";

/**
 * Policies are never edited in place: a change is a new row with a new effective_from,
 * so past invoices keep the rules they were built with.
 */
export const policies = pgTable(
  "policies",
  {
    id: id(),
    /** Null means the policy covers the whole account. */
    buildingId: uuid("building_id").references(() => buildings.id),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    settings: jsonb("settings").$type<PolicySettings>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("policies_building_effective_index").on(table.buildingId, table.effectiveFrom)],
).enableRLS();
