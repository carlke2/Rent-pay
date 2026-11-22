import "server-only";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { LEDGER_ACCOUNTS, LEDGER_ENTRY_TYPES } from "../../core/ledger/types";
import { invoiceLines } from "./billing";
import { createdAt, id } from "./columns";
import { leases } from "./tenancy";

export const paymentRequestStatus = pgEnum("payment_request_status", ["pending", "paid", "failed", "cancelled", "timed_out"]);
/** cheque: imported history only. opening: opening credit / deposit held at an import's cut-over. */
export const paymentChannel = pgEnum("payment_channel", ["stk", "paybill", "bank", "cash", "cheque", "opening"]);
/** imported = payment history from before an import's cut-over: kept for the record, never allocated or in a balance. */
export const paymentMatchStatus = pgEnum("payment_match_status", ["matched", "unmatched", "reversed", "imported"]);
export const paymentClaimStatus = pgEnum("payment_claim_status", ["waiting", "confirmed", "rejected"]);
export const ledgerEntryType = pgEnum("ledger_entry_type", LEDGER_ENTRY_TYPES);
export const ledgerAccount = pgEnum("ledger_account", LEDGER_ACCOUNTS);
export const messageChannel = pgEnum("message_channel", ["sms", "whatsapp"]);
export const paymentCallbackKind = pgEnum("payment_callback_kind", ["stk", "paybill_validation", "paybill_confirmation"]);
export const messageStatus = pgEnum("message_status", ["queued", "sent", "delivered", "failed"]);

/** Every Daraja callback is stored here first, before anything else happens. */
export const paymentCallbacks = pgTable(
  "payment_callbacks",
  {
    id: id(),
    kind: paymentCallbackKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [index("payment_callbacks_processed_at_index").on(table.processedAt)],
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: id(),
    /** Unique so duplicate M-Pesa callbacks are ignored. Null for bank and cash. */
    mpesaReceipt: text("mpesa_receipt").unique(),
    channel: paymentChannel("channel").notNull(),
    amount: integer("amount").notNull(),
    accountReference: text("account_reference"),
    payerName: text("payer_name"),
    /** Masked by C2B v2 (e.g. 2547*****126); never used for matching. */
    payerPhone: text("payer_phone"),
    /** Someone other than the lease's tenant paid (set when posted to a lease). Information only. */
    paidByOther: boolean("paid_by_other").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    leaseId: uuid("lease_id").references(() => leases.id),
    matchStatus: paymentMatchStatus("match_status").notNull().default("unmatched"),
    raw: jsonb("raw"),
    /** live, opening (opening credit / deposit held at cut-over) or import (history). */
    source: text("source").$type<"live" | "opening" | "import">().notNull().default("live"),
    importBatchId: uuid("import_batch_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("payments_lease_id_index").on(table.leaseId),
    index("payments_match_status_index").on(table.matchStatus),
    check("payments_amount_positive", sql`${table.amount} > 0`),
  ],
).enableRLS();

export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    amount: integer("amount").notNull(),
    phone: text("phone").notNull(),
    /** Who started the STK: landlord (admin request) or tenant (portal). */
    initiatedBy: text("initiated_by").notNull().default("tenant"),
    checkoutRequestId: text("checkout_request_id").unique(),
    merchantRequestId: text("merchant_request_id"),
    status: paymentRequestStatus("status").notNull().default("pending"),
    resultCode: text("result_code"),
    resultDescription: text("result_description"),
    paymentId: uuid("payment_id").references(() => payments.id),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("payment_requests_lease_id_index").on(table.leaseId),
    index("payment_requests_status_index").on(table.status),
    check("payment_requests_amount_positive", sql`${table.amount} > 0`),
  ],
).enableRLS();

export const paymentClaims = pgTable(
  "payment_claims",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    amount: integer("amount").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    /** Storage key of the uploaded slip, if any. */
    slipKey: text("slip_key"),
    status: paymentClaimStatus("status").notNull().default("waiting"),
    reason: text("reason"),
    paymentId: uuid("payment_id").references(() => payments.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("payment_claims_status_index").on(table.status),
    check("payment_claims_amount_positive", sql`${table.amount} > 0`),
  ],
).enableRLS();

export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceLineId: uuid("invoice_line_id")
      .notNull()
      .references(() => invoiceLines.id),
    amount: integer("amount").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("allocations_payment_id_index").on(table.paymentId),
    index("allocations_invoice_line_id_index").on(table.invoiceLineId),
    // Negative rows undo earlier allocations (payment reversals, deposit applied at move-out).
    check("allocations_amount_not_zero", sql`${table.amount} <> 0`),
  ],
).enableRLS();

/** Append-only: entries are never edited or deleted, only reversed. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    type: ledgerEntryType("type").notNull(),
    account: ledgerAccount("account").notNull().default("rent"),
    reference: text("reference").notNull(),
    debit: integer("debit").notNull().default(0),
    credit: integer("credit").notNull().default(0),
    invoiceLineId: uuid("invoice_line_id").references(() => invoiceLines.id),
    paymentId: uuid("payment_id").references(() => payments.id),
    reversesEntryId: uuid("reverses_entry_id")
      .unique()
      .references((): AnyPgColumn => ledgerEntries.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("ledger_entries_lease_id_index").on(table.leaseId, table.entryDate),
    check(
      "ledger_entries_one_side",
      sql`${table.debit} >= 0 and ${table.credit} >= 0 and (${table.debit} = 0) <> (${table.credit} = 0)`,
    ),
  ],
).enableRLS();

export const receipts = pgTable("receipts", {
  id: id(),
  sequence: serial("sequence").notNull().unique(),
  /** e.g. RCT-000123 */
  number: text("number").notNull().unique(),
  paymentId: uuid("payment_id")
    .notNull()
    .unique()
    .references(() => payments.id),
  /** Random token for the public receipt link. */
  token: text("token").notNull().unique(),
  /** Short Base62 code for SMS links (e.g. /receipts/{shortCode}). */
  shortCode: text("short_code").unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: createdAt(),
}).enableRLS();

export const messages = pgTable(
  "messages",
  {
    id: id(),
    recipient: text("recipient").notNull(),
    channel: messageChannel("channel").notNull().default("sms"),
    template: text("template").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("queued"),
    providerId: text("provider_id"),
    /** Provider-reported cost as given (e.g. "KES 0.8000"); not ledger money. */
    cost: text("cost"),
    leaseId: uuid("lease_id").references(() => leases.id),
    /** What the message is about, e.g. an invoice or invoice line id. */
    relatedId: uuid("related_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_recipient_index").on(table.recipient),
    // Lets reminders check what was already sent to a lease today.
    index("messages_lease_template_created_index").on(table.leaseId, table.template, table.createdAt),
  ],
).enableRLS();

