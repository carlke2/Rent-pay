import "server-only";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { INVOICE_LINE_TYPES } from "../../core/policy/types";
import { createdAt, id } from "./columns";
import { units } from "./property";
import { leases } from "./tenancy";

export const invoiceLineType = pgEnum("invoice_line_type", INVOICE_LINE_TYPES);

export type InvoiceSource = "live" | "opening" | "import";
/** Amounts of an imported charges-history row (invoice source = import). */
export type ChargeHistory = { rent: number; water: number; other: number; description: string | null };

/** regular = the monthly reading; opening = baseline at move-in; final = reading at move-out. */
export const meterReadingKind = pgEnum("meter_reading_kind", ["regular", "opening", "final"]);

export const meterReadings = pgTable(
  "meter_readings",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    /** YYYY-MM */
    period: text("period").notNull(),
    previousReading: integer("previous_reading").notNull(),
    currentReading: integer("current_reading").notNull(),
    readOn: date("read_on", { mode: "string" }).notNull(),
    kind: meterReadingKind("kind").notNull().default("regular"),
    flagged: boolean("flagged").notNull().default(false),
    confirmed: boolean("confirmed").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    unique("meter_readings_unit_period_kind_unique").on(table.unitId, table.period, table.kind),
    check("meter_readings_period_format", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
).enableRLS();

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    /** YYYY-MM */
    period: text("period").notNull(),
    /** INV-YYYYMM-0001, numbered per period. */
    number: text("number").notNull().unique(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    total: integer("total").notNull(),
    /**
     * live = generated here. opening = the opening balance / deposit held at an import's cut-over (has lines and
     * ledger entries like a live invoice). import = charges history from before the cut-over: no lines, no ledger
     * entries, so it is never "open" and never counted in a balance; the amounts are in `history`.
     */
    source: text("source").$type<InvoiceSource>().notNull().default("live"),
    history: jsonb("history").$type<ChargeHistory>(),
    importBatchId: uuid("import_batch_id"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoices_lease_period_source_unique").on(table.leaseId, table.period, table.source),
    check("invoices_source_valid", sql`${table.source} in ('live', 'opening', 'import')`),
    check("invoices_period_format", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("invoices_total_not_negative", sql`${table.total} >= 0`),
  ],
).enableRLS();

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    type: invoiceLineType("type").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    rate: integer("rate").notNull(),
    amount: integer("amount").notNull(),
    /** Part of the amount the landlord has forgiven. Open amount = amount − allocations − waived_amount. */
    waivedAmount: integer("waived_amount").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("invoice_lines_invoice_id_index").on(table.invoiceId),
    check("invoice_lines_amount_not_negative", sql`${table.amount} >= 0`),
    check("invoice_lines_waived_within_amount", sql`${table.waivedAmount} >= 0 and ${table.waivedAmount} <= ${table.amount}`),
  ],
).enableRLS();
