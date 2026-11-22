import "server-only";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { units } from "./property";

export const leaseStatus = pgEnum("lease_status", ["active", "notice", "ended"]);

export type NextOfKin = { name: string; phone: string; relationship?: string };

export const tenants = pgTable("tenants", {
  id: id(),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id"),
  /** Stored as 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: text("phone").notNull().unique(),
  alternativePhone: text("alternative_phone"),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  nextOfKin: jsonb("next_of_kin").$type<NextOfKin>(),
  portalAccess: boolean("portal_access").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
}).enableRLS();

export const leases = pgTable(
  "leases",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    rentAmount: integer("rent_amount").notNull(),
    depositAmount: integer("deposit_amount").notNull().default(0),
    status: leaseStatus("status").notNull().default("active"),
    noticeDate: date("notice_date", { mode: "string" }),
    moveOutDate: date("move_out_date", { mode: "string" }),
    /** Deposit left to return after move-out (deposit held − deposit applied to the final balance). */
    depositRefundDue: integer("deposit_refund_due").notNull().default(0),
    depositRefundedAmount: integer("deposit_refunded_amount").notNull().default(0),
    depositRefundedOn: date("deposit_refunded_on", { mode: "string" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("leases_tenant_id_index").on(table.tenantId),
    index("leases_unit_id_index").on(table.unitId),
    // A unit has at most one current (active or on-notice) lease.
    uniqueIndex("leases_one_current_per_unit").on(table.unitId).where(sql`${table.status} <> 'ended'`),
    check("leases_amounts_not_negative", sql`${table.rentAmount} >= 0 and ${table.depositAmount} >= 0`),
    check("leases_end_after_start", sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`),
  ],
).enableRLS();

export const loginCodePurpose = pgEnum("login_code_purpose", ["tenant_login", "landlord_two_factor", "phone_change"]);

export const loginCodes = pgTable(
  "login_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    purpose: loginCodePurpose("purpose").notNull().default("tenant_login"),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("login_codes_phone_index").on(table.phone, table.purpose, table.createdAt)],
).enableRLS();

/**
 * Phone-and-unit sign-in attempts, for rate limiting. `key` is "phone:2547…" or "address:<ip>"; rows older than
 * a day can be deleted at any time.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    key: text("key").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("login_attempts_key_index").on(table.key, table.createdAt)],
).enableRLS();

/** Rent changes: billing uses the latest effective_from on or before the period start, else leases.rent_amount. */
export const rentChanges = pgTable(
  "rent_changes",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    amount: integer("amount").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("rent_changes_lease_effective_index").on(table.leaseId, table.effectiveFrom),
    check("rent_changes_amount_not_negative", sql`${table.amount} >= 0`),
  ],
).enableRLS();

/** One-tap links sent by SMS that sign a tenant in to one lease. Only the token's hash is stored. */
export const payLinks = pgTable(
  "pay_links",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    tokenHash: text("token_hash").notNull().unique(),
    /** Short Base62 code for SMS links (e.g. /pay-link/{shortCode}). */
    shortCode: text("short_code").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedCount: integer("used_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index("pay_links_lease_id_index").on(table.leaseId)],
).enableRLS();
