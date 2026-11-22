import type { InvoiceLineType, PolicySettings } from "@/core/policy";
import { formatDate, formatPeriod, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { assertNonNegativeShillings, sumShillings, type Shillings } from "@/utilities/money";
import { prorateRent } from "./proration";
import { waterCharge } from "./water";

export type InvoiceLineDraft = {
  type: InvoiceLineType;
  description: string;
  quantity: number;
  rate: Shillings;
  amount: Shillings;
};

export type InvoiceLinesInput = {
  period: BillingPeriod;
  lease: {
    startDate: IsoDate;
    endDate: IsoDate | null;
    rentAmount: Shillings;
    depositAmount: Shillings;
  };
  settings: PolicySettings;
  /** Confirmed consumption for the period (meter units), if the unit is metered. */
  waterConsumption?: number | null;
  /** Adds the deposit (move-in invoice). */
  includeDeposit?: boolean;
  /** One-off lines added by the landlord. */
  extraLines?: readonly InvoiceLineDraft[];
};

/** Builds the lines for a lease's invoice. Lines with a zero amount are left out. */
export function buildInvoiceLines(input: InvoiceLinesInput): InvoiceLineDraft[] {
  const { period, lease, settings } = input;
  const lines: InvoiceLineDraft[] = [];

  const rent = prorateRent({
    monthlyRent: lease.rentAmount,
    period,
    occupiedFrom: lease.startDate,
    occupiedTo: lease.endDate,
    prorate: settings.prorate,
  });
  if (rent.amount > 0) {
    lines.push(
      rent.prorated
        ? {
            type: "rent",
            description: `Rent ${formatPeriod(period)} (${rent.daysOccupied} of ${rent.daysInPeriod} days)`,
            quantity: 1,
            rate: rent.amount,
            amount: rent.amount,
          }
        : { type: "rent", description: `Rent ${formatPeriod(period)}`, quantity: 1, rate: rent.amount, amount: rent.amount },
    );
  }

  const occupied = rent.daysOccupied > 0;

  if (occupied && input.waterConsumption !== undefined && input.waterConsumption !== null) {
    const water = waterCharge({
      consumption: input.waterConsumption,
      ratePerUnit: settings.water.ratePerUnit,
      standingCharge: settings.water.standingCharge,
    });
    if (water.usageAmount > 0) {
      lines.push({
        type: "water",
        description: `Water ${formatPeriod(period)} (${water.consumption} units)`,
        quantity: water.consumption,
        rate: water.ratePerUnit,
        amount: water.usageAmount,
      });
    }
    if (water.standingCharge > 0) {
      lines.push({
        type: "water",
        description: `Water standing charge ${formatPeriod(period)}`,
        quantity: 1,
        rate: water.standingCharge,
        amount: water.standingCharge,
      });
    }
  }

  if (occupied) {
    for (const charge of settings.fixedCharges) {
      if (charge.amount <= 0) continue;
      lines.push({ type: "fixed", description: charge.name, quantity: 1, rate: charge.amount, amount: charge.amount });
    }
  }

  if (input.includeDeposit && lease.depositAmount > 0) {
    lines.push({
      type: "deposit",
      description: `Security deposit (lease from ${formatDate(lease.startDate)})`,
      quantity: 1,
      rate: lease.depositAmount,
      amount: lease.depositAmount,
    });
  }

  for (const line of input.extraLines ?? []) {
    if (line.amount > 0) lines.push(line);
  }

  for (const line of lines) assertNonNegativeShillings(line.amount, `${line.type} line amount`);
  return lines;
}

export function invoiceTotal(lines: readonly { amount: Shillings }[]): Shillings {
  return sumShillings(lines.map((line) => line.amount));
}
