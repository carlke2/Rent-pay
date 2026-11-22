import { z } from "zod";

export const INVOICE_LINE_TYPES = ["rent", "water", "fixed", "penalty", "deposit", "other"] as const;
export type InvoiceLineType = (typeof INVOICE_LINE_TYPES)[number];

/** Line types that can be ordered for payment allocation within an invoice. */
export const ALLOCATABLE_LINE_TYPES = ["rent", "water", "fixed", "penalty", "other"] as const;
export type AllocatableLineType = (typeof ALLOCATABLE_LINE_TYPES)[number];

const wholeShillings = z.number().int().min(0);

export const penaltySettingsSchema = z.object({
  type: z.enum(["none", "flat", "percent"]),
  amount: wholeShillings,
  percent: z.number().min(0).max(100),
  repeat: z.enum(["once", "monthly"]),
});

export const policySettingsSchema = z.object({
  dueDay: z.number().int().min(1).max(31),
  graceDays: z.number().int().min(0).max(60),
  penalty: penaltySettingsSchema,
  water: z.object({
    ratePerUnit: wholeShillings,
    standingCharge: wholeShillings,
  }),
  fixedCharges: z.array(z.object({ name: z.string().trim().min(1).max(60), amount: wholeShillings })).max(20),
  prorate: z.boolean(),
  allocationOrder: z
    .array(z.enum(ALLOCATABLE_LINE_TYPES))
    .refine((order) => new Set(order).size === order.length, "allocation order must not repeat a type"),
  reminders: z.object({
    daysBeforeDue: z.number().int().min(0).max(31),
    daysAfterGrace: z.number().int().min(0).max(31),
    repeatEveryDays: z.number().int().min(0).max(31),
  }),
  overpayment: z.enum(["credit", "refund"]),
});

export type PenaltySettings = z.infer<typeof penaltySettingsSchema>;
export type PolicySettings = z.infer<typeof policySettingsSchema>;

/** A stored policy row, as core needs it. */
export type PolicyRecord = {
  id: string;
  buildingId: string | null;
  effectiveFrom: string;
  settings: unknown;
};
