/**
 * The printable report model shared by the on-screen view, the PDF (print) view and the Excel export.
 * Builders in src/reports/builders produce a ReportDocument; nothing here touches the database.
 */

export type Tone = "paid" | "partial" | "overdue" | "reversed" | "credit" | "vacant" | "neutral";
export type Tag = { label: string; tone: Tone };

export type Cell =
  | { kind: "text"; text: string; sub?: string; tag?: Tag; italic?: boolean }
  | {
      kind: "money";
      /** null shows "—" (or `label`) and counts as 0 in sums. */
      amount: number | null;
      /** Shown instead of the amount when amount is null (e.g. "Excluded"). */
      label?: string;
      tone?: "green" | "amber" | "red";
      /** Credit (a negative balance) shown as (KES 2,000). */
      brackets?: boolean;
      sub?: string;
    }
  | { kind: "count"; value: number | null };

export type ColumnType = "text" | "money" | "count";
export type Column = { key: string; label: string; type: ColumnType; /** Summed into the total row and checked. */ sum?: boolean; width?: string };
export type Row = Record<string, Cell>;

export type Table = {
  id: string;
  /** Excel sheet name (max 31 characters) and heading shown above the table. */
  title: string;
  /** Hide the heading on paper (the section heading already says it). */
  hideTitle?: boolean;
  columns: Column[];
  rows: Row[];
  /** Bold last row. Summed columns are filled from the rows and checked against `expect`. */
  total?: { label: string; cells?: Row };
  emptyText?: string;
};

export type CalcLine = {
  label: string;
  /** Signed effect on the result: "+" adds, "−" subtracts, "" is shown for information only. */
  op: "+" | "−" | "";
  amount: number | null;
  /** Shown instead of an amount, e.g. "Not counted". */
  display?: string;
  sub?: string;
};

export type Fact = [label: string, value: string];

export type Block =
  | { kind: "table"; table: Table }
  | { kind: "pair"; tables: [Table, Table] }
  | { kind: "facts"; boxes: { title: string; facts: Fact[] }[] }
  | {
      kind: "calc";
      lines: CalcLine[];
      result: { label: string; amount: number; /** Show a negative result as credit in brackets. */ credit?: boolean };
      large?: boolean;
      notes?: string[];
      /** A box shown beside the calculation (e.g. "How to pay"). */
      aside?: { title: string; facts: Fact[] };
    }
  | { kind: "bands"; title: string; bands: { label: string; amount: number; credit?: boolean }[] }
  | { kind: "reconcile"; status: "match" | "mismatch" | "none"; text: string }
  | { kind: "note"; text: string }
  | { kind: "signatures"; labels: string[] };

export type Section = { id: string; title?: string; blocks: Block[] };

export type SummaryBox = { label: string; value: string; note: string; /** Raw number for Excel. */ number?: number; money?: boolean };

export type ReportDocument = {
  slug: string;
  /** Small caps label, e.g. "Payments report". */
  kind: string;
  title: string;
  period: string;
  filter: string;
  /** Short line under the title. */
  note?: string;
  generatedAt: string;
  generatedLabel: string;
  number: string;
  landlord: { name: string; paybill: string; email: string };
  summary: SummaryBox[];
  sections: Section[];
  /** End-of-report summary: tables, the framed calculation, reconciliation, signatures. */
  closing: Section;
  /** rentpay-{report}-{period}, without extension. */
  fileName: string;
};

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

export const text = (value: string, options: Omit<Extract<Cell, { kind: "text" }>, "kind" | "text"> = {}): Cell => ({ kind: "text", text: value, ...options });
export const money = (amount: number | null, options: Omit<Extract<Cell, { kind: "money" }>, "kind" | "amount"> = {}): Cell => ({ kind: "money", amount, ...options });
export const count = (value: number | null): Cell => ({ kind: "count", value });

export const numberOf = (cell: Cell | undefined): number =>
  !cell ? 0 : cell.kind === "money" ? (cell.amount ?? 0) : cell.kind === "count" ? (cell.value ?? 0) : 0;

const amountFormat = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
/** 270390 → "KES 270,390"; −2000 → "− KES 2,000"; credit → "(KES 2,000)". */
export function kes(amount: number, options: { credit?: boolean; signed?: boolean } = {}): string {
  const body = `KES ${amountFormat.format(Math.abs(amount))}`;
  if (amount < 0) return options.credit ? `(${body})` : `− ${body}`;
  return options.signed && amount > 0 ? `+ ${body}` : body;
}
export const plain = (amount: number) => amountFormat.format(amount);

// ---------------------------------------------------------------------------
// Checks: every total is computed from the rows shown and must add up exactly.
// ---------------------------------------------------------------------------

export class ReportTotalsError extends Error {}

function fail(document: string, message: string): never {
  throw new ReportTotalsError(`Report "${document}" does not add up: ${message}`);
}

/** Fills each summed column of the total row from the rows; throws if a supplied total differs. */
export function totalTable(table: Table, documentSlug = table.id): Table {
  if (!table.total) return table;
  const cells: Row = { ...(table.total.cells ?? {}) };
  for (const column of table.columns) {
    if (!column.sum) continue;
    const sum = table.rows.reduce((total, row) => total + numberOf(row[column.key]), 0);
    const given = cells[column.key];
    if (given && numberOf(given) !== sum) fail(documentSlug, `${table.title} › ${column.label}: rows add up to ${sum}, total says ${numberOf(given)}`);
    if (!given) cells[column.key] = column.type === "count" ? count(sum) : money(sum);
  }
  return { ...table, total: { ...table.total, cells } };
}

export function assertEqual(documentSlug: string, label: string, actual: number, expected: number): void {
  if (actual !== expected) fail(documentSlug, `${label}: ${actual} ≠ ${expected}`);
}

function checkCalc(slug: string, block: Extract<Block, { kind: "calc" }>) {
  const computed = block.lines.reduce((total, line) => (line.op === "+" ? total + (line.amount ?? 0) : line.op === "−" ? total - (line.amount ?? 0) : total), 0);
  assertEqual(slug, `summary box "${block.result.label}"`, block.result.amount, computed);
}

/** Totals every table and checks every calculation box. Throws ReportTotalsError on any difference. */
export function finalise(document: ReportDocument): ReportDocument {
  const fix = (section: Section): Section => ({
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.kind === "table") return { ...block, table: totalTable(block.table, document.slug) };
      if (block.kind === "pair") return { ...block, tables: block.tables.map((table) => totalTable(table, document.slug)) as [Table, Table] };
      if (block.kind === "calc") checkCalc(document.slug, block);
      return block;
    }),
  });
  return { ...document, sections: document.sections.map(fix), closing: fix(document.closing) };
}

/** The total-row value of a column (after finalise or totalTable). */
export function tableTotal(table: Table, key: string): number {
  return table.rows.reduce((total, row) => total + numberOf(row[key]), 0);
}

export function allTables(document: ReportDocument): Table[] {
  return [...document.sections, document.closing].flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === "table" ? [block.table] : block.kind === "pair" ? block.tables : [])),
  );
}
