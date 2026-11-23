import "server-only";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";

export const unitStatus = pgEnum("unit_status", ["vacant", "occupied", "reserved", "under_repair"]);

export const landlord = pgTable("landlord", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  /** Require an SMS code after the password. */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(true),
  createdAt: createdAt(),
}).enableRLS();

export const buildings = pgTable("buildings", {
  id: id(),
  name: text("name").notNull(),
  location: text("location"),
  codePrefix: text("code_prefix").notNull().unique(),
  createdAt: createdAt(),
}).enableRLS();

export const units = pgTable(
  "units",
  {
    id: id(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id),
    /** e.g. KIL-A04; tenants use it as the Paybill account number. */
    code: text("code").notNull().unique(),
    /** Uppercase, no spaces or dashes (KILA04); matches core/payments normaliseUnitCode. Unique so two codes can't collide. */
    normalisedCode: text("normalised_code")
      .generatedAlwaysAs(sql`upper(regexp_replace(code, '[[:space:]-]+', '', 'g'))`)
      .unique(),
    type: text("type").notNull(),
    floor: integer("floor"),
    rentAmount: integer("rent_amount").notNull(),
    depositAmount: integer("deposit_amount").notNull().default(0),
    meterNumber: text("meter_number"),
    status: unitStatus("status").notNull().default("vacant"),
    createdAt: createdAt(),
  },
  (table) => [
    index("units_building_id_index").on(table.buildingId),
    check("units_amounts_not_negative", sql`${table.rentAmount} >= 0 and ${table.depositAmount} >= 0`),
  ],
).enableRLS();

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id),
    unitId: uuid("unit_id").references(() => units.id),
    category: text("category").notNull(),
    amount: integer("amount").notNull(),
    spentOn: date("spent_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    index("expenses_building_spent_index").on(table.buildingId, table.spentOn),
    index("expenses_spent_on_index").on(table.spentOn),
    check("expenses_amount_positive", sql`${table.amount} > 0`),
  ],
).enableRLS();
