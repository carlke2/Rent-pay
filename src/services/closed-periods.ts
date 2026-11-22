import "server-only";
import { isNotNull, sql } from "drizzle-orm";
import { getDatabase, type Executor } from "@/database/client";
import { importBatches } from "@/database/schema";
import { formatDate, periodOf, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { ServiceError } from "./errors";

/**
 * The latest cut-over date of a finished opening-balance import, or null if there has been none.
 * Every period before it is closed: its history came from the import.
 */
export async function closedBefore(database: Executor = getDatabase()): Promise<IsoDate | null> {
  const [row] = await database
    .select({ cutOver: sql<IsoDate | null>`max(${importBatches.cutOverDate})::text` })
    .from(importBatches)
    .where(isNotNull(importBatches.finishedAt));
  return row?.cutOver ?? null;
}

/** Throws if the billing period is before the cut-over (closed). */
export async function assertPeriodOpen(period: BillingPeriod, database: Executor = getDatabase()): Promise<void> {
  const cutOver = await closedBefore(database);
  if (cutOver && period < periodOf(cutOver)) {
    throw new ServiceError(`Periods before ${formatDate(cutOver)} are closed: they were imported as opening balances`);
  }
}

/** Throws if the date is before the cut-over (closed). */
export async function assertDateOpen(date: IsoDate, label: string, database: Executor = getDatabase()): Promise<void> {
  const cutOver = await closedBefore(database);
  if (cutOver && date < cutOver) {
    throw new ServiceError(`${label} can't be before ${formatDate(cutOver)}: earlier periods are closed (imported as opening balances)`);
  }
}
