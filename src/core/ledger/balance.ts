import { assertNonNegativeShillings, type Shillings } from "@/utilities/money";
import type { LedgerAccount } from "./types";

type Amounts = { debit: Shillings; credit: Shillings; account?: LedgerAccount };

/**
 * A lease's balance is the sum of its ledger entries (debits − credits).
 * Positive: the tenant owes. Negative: the tenant has credit.
 */
export function balanceOf(entries: readonly Amounts[]): Shillings {
  let balance = 0;
  for (const entry of entries) {
    balance += assertNonNegativeShillings(entry.debit, "debit") - assertNonNegativeShillings(entry.credit, "credit");
  }
  return balance;
}

export function balanceByAccount(entries: readonly Required<Amounts>[]): Record<LedgerAccount, Shillings> {
  return {
    rent: balanceOf(entries.filter((entry) => entry.account === "rent")),
    deposit: balanceOf(entries.filter((entry) => entry.account === "deposit")),
  };
}

/** Amount owed (never negative). */
export function amountDue(balance: Shillings): Shillings {
  return Math.max(0, balance);
}

/** Credit held (never negative). */
export function creditHeld(balance: Shillings): Shillings {
  return Math.max(0, -balance);
}
