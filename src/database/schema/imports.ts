import "server-only";
import { date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";

/**
 * One opening-balance import. Its cut-over date closes every period before it: no invoices, payments or
 * readings can be added for those periods afterwards (see services/imports closedBefore).
 */
export const importBatches = pgTable("import_batches", {
  id: id(),
  fileName: text("file_name").notNull(),
  cutOverDate: date("cut_over_date", { mode: "string" }).notNull(),
  actor: text("actor").notNull(),
  unitsImported: integer("units_imported").notNull().default(0),
  counts: jsonb("counts"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
});
