import type { InvoiceLineType } from "@/core/policy";
import type { IsoDate } from "@/utilities/dates";
import { assertNonNegativeShillings, type Shillings } from "@/utilities/money";
import type { LedgerAccount, LedgerEntryDraft } from "./types";

/**
 * One receivable per lease: every charge, the deposit included, is posted to the "rent" account.
 * The deposit held is worked out from allocations to deposit lines instead of a separate account.
 */
export function accountForLine(_type: InvoiceLineType): LedgerAccount {
  return "rent";
}

/** One debit entry per invoice line. */
export function chargeEntries(input: {
  leaseId: string;
  entryDate: IsoDate;
  invoiceNumber: string;
  lines: readonly { id: string; type: InvoiceLineType; amount: Shillings }[];
}): LedgerEntryDraft[] {
  return input.lines
    .filter((line) => assertNonNegativeShillings(line.amount, "line amount") > 0)
    .map((line) => ({
      leaseId: input.leaseId,
      entryDate: input.entryDate,
      type: "charge",
      account: accountForLine(line.type),
      reference: input.invoiceNumber,
      debit: line.amount,
      credit: 0,
      invoiceLineId: line.id,
      paymentId: null,
      reversesEntryId: null,
    }));
}

/** The credit entry for a received payment. */
export function paymentEntry(input: {
  leaseId: string;
  entryDate: IsoDate;
  paymentId: string;
  reference: string;
  amount: Shillings;
  account?: LedgerAccount;
}): LedgerEntryDraft {
  if (assertNonNegativeShillings(input.amount, "payment amount") === 0) {
    throw new RangeError("payment amount must be greater than zero");
  }
  return {
    leaseId: input.leaseId,
    entryDate: input.entryDate,
    type: "payment",
    account: input.account ?? "rent",
    reference: input.reference,
    debit: 0,
    credit: input.amount,
    invoiceLineId: null,
    paymentId: input.paymentId,
    reversesEntryId: null,
  };
}

/** A manual adjustment: positive amount adds to what is owed, negative reduces it. */
export function adjustmentEntry(input: {
  leaseId: string;
  entryDate: IsoDate;
  reference: string;
  amount: Shillings;
  account: LedgerAccount;
}): LedgerEntryDraft {
  if (input.amount === 0) throw new RangeError("adjustment amount must not be zero");
  const size = Math.abs(input.amount);
  return {
    leaseId: input.leaseId,
    entryDate: input.entryDate,
    type: "adjustment",
    account: input.account,
    reference: input.reference,
    debit: input.amount > 0 ? size : 0,
    credit: input.amount < 0 ? size : 0,
    invoiceLineId: null,
    paymentId: null,
    reversesEntryId: null,
  };
}

/** Entries are never edited or deleted; a mistake is undone with an equal and opposite entry. */
export function reversalOf(
  entry: LedgerEntryDraft & { id: string },
  input: { entryDate: IsoDate; reference: string },
): LedgerEntryDraft {
  if (entry.type === "reversal") throw new Error("a reversal cannot itself be reversed; post a new entry instead");
  return {
    leaseId: entry.leaseId,
    entryDate: input.entryDate,
    type: "reversal",
    account: entry.account,
    reference: input.reference,
    debit: entry.credit,
    credit: entry.debit,
    invoiceLineId: entry.invoiceLineId,
    paymentId: entry.paymentId,
    reversesEntryId: entry.id,
  };
}
