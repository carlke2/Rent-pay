import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { clampPage, encodeCursor, PAGE_SIZE, pageInfo, type KeysetPage, type OffsetPage, type PageRequest } from "@/utilities/pagination";

/** One sort key of a keyset list, with the type its cursor text is cast back to. */
export type KeysetKey = { expression: SQL; cast: "timestamptz" | "date" | "uuid" | "int" };

/**
 * How to fetch one page of a list sorted by `keys` (all ascending or all descending; the last key must be unique,
 * e.g. the id). With a cursor it seeks past the cursor row; without one it uses the page's offset.
 * `reverse`: rows were fetched backwards (Previous) and must be reversed before showing.
 */
export function keysetPlan(keys: readonly KeysetKey[], order: "asc" | "desc", request: PageRequest) {
  const backwards = request.cursor !== null && request.direction === "prev";
  const fetchOrder = backwards ? (order === "asc" ? "desc" : "asc") : order;
  const orderBy = keys.map((key) => (fetchOrder === "asc" ? sql`${key.expression} asc` : sql`${key.expression} desc`));

  let where: SQL | undefined;
  if (request.cursor && request.cursor.length === keys.length) {
    const columns = sql.join(keys.map((key) => key.expression), sql`, `);
    const values = sql.join(keys.map((key, index) => sql`${request.cursor![index]}::${sql.raw(key.cast)}`), sql`, `);
    // Seeking forward in a descending list (or backward in an ascending one) means "smaller than the cursor".
    where = fetchOrder === "desc" ? sql`(${columns}) < (${values})` : sql`(${columns}) > (${values})`;
  }
  const offset = where ? 0 : (request.page - 1) * PAGE_SIZE;
  return { where, orderBy, limit: PAGE_SIZE, offset, reverse: backwards };
}

export type KeysetPlan = ReturnType<typeof keysetPlan>;

/**
 * Fetches one page of a keyset list and its total together. Falls back to the offset when a cursor finds nothing
 * (rows removed since the link was made) and clamps a page past the end to the last page.
 */
export async function fetchKeysetPage<Row>(input: {
  keys: readonly KeysetKey[];
  order: "asc" | "desc";
  request: PageRequest;
  count: () => Promise<number>;
  fetch: (plan: KeysetPlan) => Promise<Row[]>;
  /** The row's sort-key values as text, in `keys` order (select them with ::text so timestamps keep microseconds). */
  cursorOf: (row: Row) => string[];
}): Promise<KeysetPage<Row>> {
  const plan = keysetPlan(input.keys, input.order, input.request);
  let [total, rows] = await Promise.all([input.count(), input.fetch(plan)]);
  let page = input.request.page;
  if (rows.length === 0 && total > 0) {
    // Stale cursor or a page past the end: show the last real page by offset instead.
    page = clampPage(page, total);
    rows = await input.fetch(keysetPlan(input.keys, input.order, { page, cursor: null, direction: "next" }));
  } else if (plan.reverse) {
    rows = rows.reverse();
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    rows,
    info: pageInfo(page, total, rows.length),
    firstCursor: first ? encodeCursor(input.cursorOf(first)) : null,
    lastCursor: last ? encodeCursor(input.cursorOf(last)) : null,
  };
}

/** One page of a plain limit/offset list and its total, fetched together; a page past the end shows the last page. */
export async function fetchOffsetPage<Row>(input: {
  request: PageRequest;
  count: () => Promise<number>;
  fetch: (limit: number, offset: number) => Promise<Row[]>;
}): Promise<OffsetPage<Row>> {
  let page = input.request.page;
  let [total, rows] = await Promise.all([input.count(), input.fetch(PAGE_SIZE, (page - 1) * PAGE_SIZE)]);
  if (rows.length === 0 && total > 0) {
    page = clampPage(page, total);
    rows = await input.fetch(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  }
  return { rows, info: pageInfo(page, total, rows.length) };
}
