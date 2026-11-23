import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/utilities/class-names";
import { pageParamNames, type PageInfo, type SearchParams } from "@/utilities/pagination";

type Props = {
  info: PageInfo;
  /** The page's current search params: filters are kept, this list's page/cursor are replaced. */
  params: SearchParams;
  pathname: string;
  /** id of the element above the table; page links scroll back to it. */
  anchor: string;
  /** Param prefix when one screen has several lists (e.g. "ledger" → ledger_page). */
  prefix?: string;
  /** Keyset lists: cursors of the first and last row shown. Previous/Next seek from them instead of an offset. */
  firstCursor?: string | null;
  lastCursor?: string | null;
  /** Params that should not survive a page change (e.g. one that opens a dialog). */
  omit?: readonly string[];
  className?: string;
};

const buttonClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border bg-card px-3 text-sm font-medium text-foreground no-underline hover:bg-surface-muted";
const disabledClass = "pointer-events-none opacity-45";

/** Page numbers to show on desktop: first, last, and two either side of the current page, with gaps as null. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1]! > 1) result.push(null);
    result.push(value);
  });
  return result;
}

/** "Showing 26–50 of 132" with Previous / Next (and page numbers on desktop) under a list. */
export function Pagination({ info, params, pathname, anchor, prefix, firstCursor, lastCursor, omit = [], className }: Props) {
  const names = pageParamNames(prefix);
  const href = (page: number, cursor?: { name: "after" | "before"; value: string | null | undefined }) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === names.page || key === names.after || key === names.before || omit.includes(key)) continue;
      if (typeof value === "string" && value !== "") next.set(key, value);
    }
    if (page > 1) {
      next.set(names.page, String(page));
      if (cursor?.value) next.set(names[cursor.name], cursor.value);
    }
    const query = next.toString();
    return `${pathname}${query ? `?${query}` : ""}#${anchor}`;
  };

  const { page, pageCount, first, last, total } = info;
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav aria-label="Pages" className={cn("mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 print:hidden", className)}>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? "No rows" : <>Showing <span className="numbers font-medium text-foreground">{first.toLocaleString("en-KE")}–{last.toLocaleString("en-KE")}</span> of <span className="numbers font-medium text-foreground">{total.toLocaleString("en-KE")}</span></>}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1.5">
          {hasPrevious ? (
            <Link href={href(page - 1, { name: "before", value: firstCursor })} prefetch={false} rel="prev" className={buttonClass}>
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonClass, disabledClass)}>
              <ChevronLeft className="size-4" aria-hidden /> Previous
            </span>
          )}
          <ol className="hidden items-center gap-1 md:flex">
            {pageWindow(page, pageCount).map((value, index) =>
              value === null ? (
                <li key={`gap-${index}`} className="px-1 text-muted-foreground" aria-hidden>
                  …
                </li>
              ) : (
                <li key={value}>
                  {value === page ? (
                    <span aria-current="page" className={cn(buttonClass, "numbers border-foreground bg-foreground text-background hover:bg-foreground")}>
                      {value}
                    </span>
                  ) : (
                    <Link href={href(value)} prefetch={false} aria-label={`Page ${value}`} className={cn(buttonClass, "numbers")}>
                      {value}
                    </Link>
                  )}
                </li>
              ),
            )}
          </ol>
          {hasNext ? (
            <Link href={href(page + 1, { name: "after", value: lastCursor })} prefetch={false} rel="next" className={buttonClass}>
              Next <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(buttonClass, disabledClass)}>
              Next <ChevronRight className="size-4" aria-hidden />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/** Wrap a paginated list in this so its page links can scroll back to the top of it (clear of the sticky top bar). */
export function ListAnchor({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      {children}
    </section>
  );
}

/** A stable key for a list's Suspense boundary: changes whenever the URL (filters or page) changes. */
export function paramsKey(params: SearchParams): string {
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}
