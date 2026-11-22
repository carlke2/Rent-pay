import type { IsoDate } from "@/utilities/dates";
import type { Shillings } from "@/utilities/money";

export const LEDGER_ENTRY_TYPES = ["charge", "payment", "adjustment", "reversal"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_ACCOUNTS = ["rent", "deposit"] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

/** A ledger entry before it is saved. Debits increase what the tenant owes; credits reduce it. */
export type LedgerEntryDraft = {
  leaseId: string;
  entryDate: IsoDate;
  type: LedgerEntryType;
  account: LedgerAccount;
  reference: string;
  debit: Shillings;
  credit: Shillings;
  invoiceLineId: string | null;
  paymentId: string | null;
  reversesEntryId: string | null;
};
