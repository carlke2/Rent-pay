import "server-only";
import ExcelJS from "exceljs";
import { allTables, type Block, type Cell, type ReportDocument, type Table } from "./document";

const KES_FORMAT = '"KES "#,##0;[Red]-"KES "#,##0;"KES "0';
const COUNT_FORMAT = "#,##0";
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F2EC" } };
const CREAM_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F3EA" } };

function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let index = 2; used.has(name.toLowerCase()); index += 1) name = `${base.slice(0, 31 - String(index).length - 1)} ${index}`;
  used.add(name.toLowerCase());
  return name;
}

const columnLetter = (index: number): string => {
  let letters = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  return letters;
};

type SheetColumn = { header: string; width: number; get: (cell: Cell | undefined) => ExcelJS.CellValue; format?: string; sum: boolean; key: string; detail: boolean };

/** Expands a table's columns for a spreadsheet: a text column with notes underneath gets a second column for them. */
function sheetColumns(table: Table): SheetColumn[] {
  const columns: SheetColumn[] = [];
  const all = [...table.rows, ...(table.total?.cells ? [table.total.cells] : [])];
  for (const column of table.columns) {
    if (column.type === "money") {
      columns.push({ header: column.label, key: column.key, width: 16, format: KES_FORMAT, sum: Boolean(column.sum), detail: false, get: (cell) => (cell?.kind === "money" ? (cell.amount ?? cell.label ?? null) : null) });
      continue;
    }
    if (column.type === "count") {
      columns.push({ header: column.label, key: column.key, width: 12, format: COUNT_FORMAT, sum: Boolean(column.sum), detail: false, get: (cell) => (cell?.kind === "count" ? cell.value : null) });
      continue;
    }
    const longest = Math.max(column.label.length, ...table.rows.map((row) => { const cell = row[column.key]; return cell?.kind === "text" ? (cell.text || cell.tag?.label || "").length : 0; }));
    columns.push({
      header: column.label,
      key: column.key,
      width: Math.min(60, Math.max(10, longest + 2)),
      sum: false,
      detail: false,
      get: (cell) => (cell?.kind === "text" ? cell.text || cell.tag?.label || null : null),
    });
    if (all.some((row) => row[column.key]?.kind === "text" && (row[column.key] as { sub?: string }).sub)) {
      const label = column.key === "channel" ? "Reference" : column.key === "description" ? "Reference" : `${column.label} details`;
      const longestSub = Math.max(label.length, ...table.rows.map((row) => { const cell = row[column.key]; return cell?.kind === "text" ? (cell.sub ?? "").length : 0; }));
      columns.push({ header: label, key: `${column.key}:sub`, width: Math.min(60, Math.max(10, longestSub + 2)), sum: false, detail: true, get: (cell) => (cell?.kind === "text" ? (cell.sub ?? null) : null) });
    }
  }
  return columns;
}

function addTableSheet(workbook: ExcelJS.Workbook, table: Table, name: string) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  const columns = sheetColumns(table);
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width, style: column.format ? { numFmt: column.format } : {} }));
  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.fill = HEAD_FILL;
  head.border = { bottom: { style: "thin", color: { argb: "FFA1A1AA" } } };
  columns.forEach((column, index) => {
    if (column.format) head.getCell(index + 1).alignment = { horizontal: "right" };
  });

  for (const row of table.rows) {
    sheet.addRow(columns.map((column) => column.get(row[column.key.replace(/:sub$/, "")])));
  }
  const first = 2;
  const last = table.rows.length + 1;
  if (table.total) {
    const values = columns.map((column, index): ExcelJS.CellValue => {
      if (index === 0) return table.total!.label;
      if (column.sum) {
        const letter = columnLetter(index + 1);
        const result = table.rows.reduce((sum, row) => {
          const value = column.get(row[column.key]);
          return sum + (typeof value === "number" ? value : 0);
        }, 0);
        return table.rows.length ? { formula: `SUM(${letter}${first}:${letter}${last})`, result } : 0;
      }
      return column.detail ? null : column.get(table.total!.cells?.[column.key]);
    });
    const total = sheet.addRow(values);
    total.font = { bold: true };
    total.border = { top: { style: "thin" }, bottom: { style: "medium" } };
  }
  return sheet;
}

function addBlockLines(sheet: ExcelJS.Worksheet, block: Block) {
  if (block.kind === "calc") {
    const start = sheet.rowCount + 1;
    const signed: string[] = [];
    block.lines.forEach((line, index) => {
      const row = sheet.addRow([line.label, line.display ?? (line.amount === null ? null : line.op === "−" ? -line.amount : line.amount), line.sub ?? null]);
      if (line.display === undefined && line.amount !== null && line.op !== "") signed.push(`B${start + index}`);
      row.getCell(2).numFmt = KES_FORMAT;
    });
    const result = sheet.addRow([block.result.label, signed.length ? { formula: signed.join("+"), result: block.result.amount } : block.result.amount]);
    result.font = { bold: true, size: 13 };
    result.fill = CREAM_FILL;
    result.getCell(2).numFmt = KES_FORMAT;
    for (const note of block.notes ?? []) sheet.addRow([note]);
    if (block.aside) {
      sheet.addRow([]);
      sheet.addRow([block.aside.title]).font = { bold: true };
      for (const [label, value] of block.aside.facts) sheet.addRow([label, value]);
    }
  } else if (block.kind === "bands") {
    sheet.addRow([]);
    sheet.addRow([block.title]).font = { bold: true };
    for (const band of block.bands) sheet.addRow([band.label, band.amount]).getCell(2).numFmt = KES_FORMAT;
  } else if (block.kind === "reconcile") {
    sheet.addRow([]);
    const row = sheet.addRow([block.text]);
    row.font = { color: { argb: block.status === "match" ? "FF166534" : block.status === "mismatch" ? "FFB91C1C" : "FF3F3F46" }, bold: true };
  } else if (block.kind === "facts") {
    for (const box of block.boxes) {
      sheet.addRow([]);
      sheet.addRow([box.title]).font = { bold: true };
      for (const [label, value] of box.facts) sheet.addRow([label, value]);
    }
  } else if (block.kind === "note") {
    sheet.addRow([block.text]);
  } else if (block.kind === "signatures") {
    sheet.addRow([]);
    for (const label of block.labels) sheet.addRow([`${label}:`, "", "Date:"]);
  }
}

/**
 * The report as a workbook: a Summary sheet first (header, the four summary figures, the closing calculation),
 * then one sheet per table with a frozen header row, real numbers in a KES format and SUM formulas on total rows.
 */
export async function reportWorkbook(document: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RentPay";
  // Excel recalculates every formula on open; the cached results below are for viewers that do not.
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.created = new Date(document.generatedAt);
  const used = new Set<string>(["summary"]);

  const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 6 }] });
  summary.columns = [{ width: 52 }, { width: 22 }, { width: 44 }];
  summary.addRow([document.title]).font = { bold: true, size: 16 };
  summary.addRow([`${document.kind} · ${document.period} · ${document.filter}`]);
  summary.addRow([`Generated ${document.generatedLabel} EAT · ${document.number}`]);
  summary.addRow([`${document.landlord.name} · Paybill ${document.landlord.paybill}${document.landlord.email ? ` · ${document.landlord.email}` : ""}`]);
  summary.addRow([]);
  const head = summary.addRow(["Figure", "Value", "Note"]);
  head.font = { bold: true };
  head.fill = HEAD_FILL;
  for (const [index, box] of document.summary.entries()) {
    const row = summary.addRow([box.label, box.number ?? box.value, box.note]);
    row.getCell(2).numFmt = box.money ? KES_FORMAT : COUNT_FORMAT;
    if (index === 0) {
      row.font = { bold: true };
      row.fill = CREAM_FILL;
    }
  }
  if (document.note) summary.addRow([document.note]);
  summary.addRow([]);
  summary.addRow([document.closing.title ?? "Summary"]).font = { bold: true, size: 13 };
  for (const section of document.sections) for (const block of section.blocks) if (block.kind === "facts") addBlockLines(summary, block);
  for (const block of document.closing.blocks) addBlockLines(summary, block);
  summary.addRow([]);
  summary.addRow([`Figures as at ${document.generatedLabel} EAT. Amounts in Kenya shillings. Generated by RentPay.`]).font = { italic: true, color: { argb: "FF52525B" } };

  for (const table of allTables(document)) {
    if (table.rows.length === 0 && table.emptyText) continue;
    addTableSheet(workbook, table, sheetName(table.title, used));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
