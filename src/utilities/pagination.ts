/**
 * Server-side pagination: 25 rows per page, with the page (and filters) in the URL so links and Back work.
 *
 * Two kinds of list:
 * - offset lists: ?page=3 → rows 51–75.
 * - keyset lists (payments, ledger): Previous/Next carry a cursor (?page=3&after=…) taken from the last or first
 *   row shown, so the database seeks straight to the next rows instead of counting past every earlier one.
 *   A bare ?page=N (the desktop page-number links) still works, by offset.
 *
 * A list can use a prefix (e.g. "ledger" → ledger_page, ledger_after, ledger_before) when one screen shows several.
 */

export const PAGE_SIZE = 25;

export type SearchParams = Record<string, string | string[] | undefined>;

export type PageParamNames = { page: string; after: string; before: string };

export function pageParamNames(prefix?: string): PageParamNames {
  return prefix ? { page: `${prefix}_page`, after: `${prefix}_after`, before: `${prefix}_before` } : { page: "page", after: "after", before: "before" };
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A list's position from the URL: page number (1-based) and, for keyset lists, the cursor to seek from. */
export type PageRequest = {
  page: number;
  /** Decoded cursor values; null means "use the offset for this page". */
  cursor: string[] | null;
  direction: "next" | "prev";
};

export function readPageRequest(params: SearchParams, prefix?: string): PageRequest {
  const names = pageParamNames(prefix);
  const raw = Number(single(params[names.page]));
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 100_000 ? raw : 1;
  const after = decodeCursor(single(params[names.after]));
  const before = decodeCursor(single(params[names.before]));
  if (page > 1 && after) return { page, cursor: after, direction: "next" };
  if (page > 1 && before) return { page, cursor: before, direction: "prev" };
  return { page, cursor: null, direction: "next" };
}

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  /** 1-based position of the first and last row shown ("Showing 26–50 of 132"); 0 when empty. */
  first: number;
  last: number;
};

export function pageInfo(page: number, total: number, shown: number, pageSize = PAGE_SIZE): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const first = shown === 0 ? 0 : Math.min((current - 1) * pageSize + 1, total);
  const last = shown === 0 ? 0 : Math.min(first + shown - 1, total);
  return { page: current, pageSize, total, pageCount, first, last };
}

/** The page number to use for an offset query: clamped so a stale ?page=9 on a 3-page list shows page 3. */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / pageSize)));
}

/** One page of an offset list. */
export type OffsetPage<Row> = { rows: Row[]; info: PageInfo };

/** One page of a keyset list, with the cursors Previous and Next link to. */
export type KeysetPage<Row> = OffsetPage<Row> & { firstCursor: string | null; lastCursor: string | null };

/** For lists that must be computed in full first (balances worked out in code): paginates on the server after. */
export function slicePage<Row>(rows: readonly Row[], page: number, pageSize = PAGE_SIZE): OffsetPage<Row> {
  const current = clampPage(page, rows.length, pageSize);
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  return { rows: pageRows, info: pageInfo(current, rows.length, pageRows.length, pageSize) };
}

/** Cursor = the sort-key values of one row, as text, in base64url JSON. */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values.map(String)), "utf8").toString("base64url");
}

export function decodeCursor(text: string | undefined): string[] | null {
  if (!text || text.length > 400) return null;
  try {
    const values: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    return Array.isArray(values) && values.length > 0 && values.length <= 6 && values.every((value) => typeof value === "string" && value.length <= 80)
      ? (values as string[])
      : null;
  } catch {
    return null;
  }
}
