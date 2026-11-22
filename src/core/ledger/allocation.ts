import type { AllocatableLineType, InvoiceLineType } from "@/core/policy";
import type { BillingPeriod, IsoDate } from "@/utilities/dates";
import { assertNonNegativeShillings, type Shillings } from "@/utilities/money";

export type OpenInvoiceLine = {
  invoiceLineId: string;
  invoiceId: string;
  period: BillingPeriod;
  dueDate: IsoDate;
  invoiceNumber: string;
  type: InvoiceLineType;
  /** Amount still unpaid on this line. */
  outstanding: Shillings;
};

export type Allocation = { invoiceLineId: string; amount: Shillings };

export type AllocationResult = {
  allocations: Allocation[];
  allocated: Shillings;
  /** What is left after every open line is paid; becomes credit (or a refund, per policy). */
  leftover: Shillings;
};

/**
 * Splits a payment across open invoice lines:
 * oldest invoice first, then by `allocationOrder` within an invoice.
 * Types not in the order (e.g. deposit) come after the listed ones.
 */
export function allocatePayment(input: {
  amount: Shillings;
  openLines: readonly OpenInvoiceLine[];
  allocationOrder: readonly AllocatableLineType[];
}): AllocationResult {
  assertNonNegativeShillings(input.amount, "payment amount");

  const rank = (type: InvoiceLineType) => {
    const index = (input.allocationOrder as readonly string[]).indexOf(type);
    return index === -1 ? input.allocationOrder.length : index;
  };

  const ordered = input.openLines
    .map((line, position) => ({ line, position }))
    .filter(({ line }) => assertNonNegativeShillings(line.outstanding, "outstanding") > 0)
    .sort(
      (a, b) =>
        a.line.period.localeCompare(b.line.period) ||
        a.line.dueDate.localeCompare(b.line.dueDate) ||
        a.line.invoiceNumber.localeCompare(b.line.invoiceNumber) ||
        rank(a.line.type) - rank(b.line.type) ||
        a.position - b.position,
    );

  let remaining = input.amount;
  const allocations: Allocation[] = [];
  for (const { line } of ordered) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, line.outstanding);
    allocations.push({ invoiceLineId: line.invoiceLineId, amount });
    remaining -= amount;
  }

  return { allocations, allocated: input.amount - remaining, leftover: remaining };
}

/** Outstanding per line: line amount minus what has already been allocated to it. */
export function outstandingByLine(
  lines: readonly { id: string; amount: Shillings }[],
  allocations: readonly Allocation[],
): Map<string, Shillings> {
  const paid = new Map<string, Shillings>();
  for (const allocation of allocations) {
    paid.set(allocation.invoiceLineId, (paid.get(allocation.invoiceLineId) ?? 0) + allocation.amount);
  }
  return new Map(lines.map((line) => [line.id, Math.max(0, line.amount - (paid.get(line.id) ?? 0))]));
}
