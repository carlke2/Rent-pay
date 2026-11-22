import "server-only";
import ExcelJS from "exceljs";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getEnvironment } from "@/configuration/environment";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase, type Transaction } from "@/database/client";
import {
  allocations,
  buildings,
  importBatches,
  invoiceLines,
  invoices,
  landlord,
  ledgerEntries,
  leases,
  meterReadings,
  payments,
  tenants,
  units,
} from "@/database/schema";
import {
  addDays,
  firstDayOfPeriod,
  formatDate,
  isBillingPeriod,
  isIsoDate,
  periodOf,
  startOfNairobiDay,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";
import { formatShillings, sumShillings } from "@/utilities/money";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { writeAudit } from "./audit";
import { ServiceError } from "./errors";
import { sendSms } from "./notifications";

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

type Column = { key: string; header: string; note: string; width?: number; required?: boolean };

const SHEETS = {
  tenants: {
    name: "Tenants and units",
    columns: [
      { key: "building", header: "Building", note: "Building name. A new building is created if it doesn't exist.", width: 22, required: true },
      { key: "unitCode", header: "Unit code", note: "e.g. KIL-A01. Tenants use it as the Paybill account number.", width: 12, required: true },
      { key: "unitType", header: "Unit type", note: "e.g. Bedsitter, 1 bedroom. Needed for new units.", width: 14 },
      { key: "rent", header: "Rent", note: "Monthly rent in whole shillings.", width: 10, required: true },
      { key: "depositAmount", header: "Deposit amount", note: "The deposit agreed for the unit.", width: 14 },
      { key: "tenantName", header: "Tenant full name", note: "", width: 24, required: true },
      { key: "phone", header: "Phone", note: "Safaricom/Airtel number, e.g. 0712345678.", width: 14, required: true },
      { key: "alternativePhone", header: "Alternative phone", note: "Optional.", width: 16 },
      { key: "nationalId", header: "National ID", note: "Optional.", width: 12 },
      { key: "leaseStart", header: "Lease start date", note: "YYYY-MM-DD. Must be before the cut-over date.", width: 15, required: true },
      { key: "depositHeld", header: "Deposit held", note: "The deposit you actually hold for this tenant today.", width: 12 },
      {
        key: "balance",
        header: "Balance at cut-over",
        note: "What the tenant owes the day before the cut-over. Positive = owed, negative = credit, 0 = settled.",
        width: 18,
        required: true,
      },
      { key: "lastReading", header: "Last meter reading", note: "Optional. Saved as a confirmed reading so the next water bill starts from it.", width: 17 },
      { key: "readingDate", header: "Reading date", note: "YYYY-MM-DD. Needed with a meter reading.", width: 13 },
    ],
  },
  payments: {
    name: "Payment history",
    columns: [
      { key: "date", header: "Date", note: "YYYY-MM-DD, before the cut-over date.", width: 12, required: true },
      { key: "unitCode", header: "Unit code", note: "Must be on the Tenants and units sheet.", width: 12, required: true },
      { key: "amount", header: "Amount", note: "Whole shillings.", width: 10, required: true },
      { key: "method", header: "Method", note: "mpesa, bank, cash or cheque.", width: 10, required: true },
      { key: "reference", header: "Reference", note: "M-Pesa code, bank or cheque number. Must be unique.", width: 16 },
      { key: "note", header: "Note", note: "Optional.", width: 24 },
    ],
  },
  charges: {
    name: "Charges history",
    columns: [
      { key: "month", header: "Month", note: "YYYY-MM, before the cut-over month.", width: 10, required: true },
      { key: "unitCode", header: "Unit code", note: "Must be on the Tenants and units sheet.", width: 12, required: true },
      { key: "rent", header: "Rent", note: "Whole shillings.", width: 10 },
      { key: "water", header: "Water", note: "Whole shillings.", width: 10 },
      { key: "other", header: "Other", note: "Whole shillings (garbage, security…).", width: 10 },
      { key: "description", header: "Description", note: "Optional.", width: 24 },
    ],
  },
} as const satisfies Record<string, { name: string; columns: readonly Column[] }>;

type SheetKey = keyof typeof SHEETS;

/** The downloadable XLSX template: three sheets, header notes, text-formatted codes and phones. */
export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = getEnvironment().APP_NAME;
  for (const sheetKey of Object.keys(SHEETS) as SheetKey[]) {
    const definition = SHEETS[sheetKey];
    const sheet = workbook.addWorksheet(definition.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = definition.columns.map((column) => ({ header: column.header, key: column.key, width: column.width ?? 14 }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };
    definition.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      const required = "required" in column && column.required;
      const note = `${required ? "Required. " : ""}${column.note}`.trim();
      if (note) cell.note = note;
      // Keep codes, phones, IDs and references as text so Excel doesn't drop leading zeros.
      if (["unitCode", "phone", "alternativePhone", "nationalId", "reference", "month"].includes(column.key)) {
        sheet.getColumn(index + 1).numFmt = "@";
      }
      if (["leaseStart", "readingDate", "date"].includes(column.key)) sheet.getColumn(index + 1).numFmt = "yyyy-mm-dd";
    });
    if (sheetKey === "payments") {
      // A range rule (not per cell) so the sheet has no pre-made empty rows.
      (sheet as unknown as { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } }).dataValidations.add("D2:D5000", {
        type: "list",
        allowBlank: true,
        formulae: ['"mpesa,bank,cash,cheque"'],
      });
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Cell = string | number | Date | null;
type RawRow = { row: number; values: Record<string, Cell> };

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value) return cellValue(value.richText.map((part) => part.text).join(""));
    if ("text" in value) return cellValue(String(value.text));
  }
  return String(value);
}

const headerKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function readWorkbook(bytes: ArrayBuffer): Promise<{ sheets: Record<SheetKey, RawRow[] | null>; errors: ImportIssue[] }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw new ServiceError("That file isn't a readable .xlsx workbook. Download the template and fill it in.");
  }
  const errors: ImportIssue[] = [];
  const sheets = { tenants: null, payments: null, charges: null } as Record<SheetKey, RawRow[] | null>;

  for (const sheetKey of Object.keys(SHEETS) as SheetKey[]) {
    const definition = SHEETS[sheetKey];
    const sheet = workbook.worksheets.find((candidate) => headerKey(candidate.name) === headerKey(definition.name));
    if (!sheet) {
      if (sheetKey === "tenants") errors.push({ sheet: definition.name, row: null, message: `The "${definition.name}" sheet is missing` });
      continue;
    }
    const columnIndex = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, index) => {
      const text = cellValue(cell.value);
      const column = definition.columns.find((candidate) => typeof text === "string" && headerKey(candidate.header) === headerKey(text));
      if (column) columnIndex.set(column.key, index);
    });
    const missing = definition.columns.filter((column) => "required" in column && column.required && !columnIndex.has(column.key));
    if (missing.length > 0) {
      errors.push({ sheet: definition.name, row: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((column) => column.header).join(", ")}` });
      continue;
    }
    const rows: RawRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const values: Record<string, Cell> = {};
      let any = false;
      for (const [key, index] of columnIndex) {
        const value = cellValue(row.getCell(index).value);
        values[key] = value;
        if (value !== null) any = true;
      }
      if (any) rows.push({ row: rowNumber, values });
    }
    sheets[sheetKey] = rows;
  }
  return { sheets, errors };
}

// ---------------------------------------------------------------------------
// Field readers (each returns a value or pushes an issue)
// ---------------------------------------------------------------------------

export type ImportIssue = { sheet: string; row: number | null; message: string };

function utcIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10) as IsoDate;
}

function readDate(value: Cell): IsoDate | null | "invalid" {
  if (value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "invalid" : utcIso(value);
  if (typeof value === "number") {
    // An Excel serial date in a cell without a date format.
    if (value < 20_000 || value > 80_000) return "invalid";
    return utcIso(new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000));
  }
  const text = value.trim();
  if (isIsoDate(text)) return text;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
    if (isIsoDate(iso)) return iso;
  }
  return "invalid";
}

function readMonth(value: Cell): BillingPeriod | null | "invalid" {
  if (value === null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "invalid" : (utcIso(value).slice(0, 7) as BillingPeriod);
  const text = String(value).trim();
  if (isBillingPeriod(text)) return text;
  const my = /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (my) {
    const period = `${my[2]}-${my[1]!.padStart(2, "0")}`;
    if (isBillingPeriod(period)) return period;
  }
  const asDate = readDate(value);
  return asDate && asDate !== "invalid" ? (asDate.slice(0, 7) as BillingPeriod) : "invalid";
}

function readAmount(value: Cell): number | null | "invalid" {
  if (value === null) return null;
  const number = typeof value === "number" ? value : value instanceof Date ? Number.NaN : Number(String(value).replace(/,/g, "").replace(/^KES\s*/i, "").trim());
  if (!Number.isFinite(number) || !Number.isInteger(number) || !Number.isSafeInteger(number)) return "invalid";
  return number;
}

function readText(value: Cell): string | null {
  if (value === null) return null;
  if (value instanceof Date) return utcIso(value);
  const text = String(value).trim();
  return text === "" ? null : text;
}

function readPhone(value: Cell): string | null | "invalid" {
  if (value === null) return null;
  let text = typeof value === "number" ? String(Math.round(value)) : String(value);
  text = text.replace(/[\s\-()]/g, "");
  // Excel drops the leading 0 from 0712345678 when the cell is a number.
  if (/^[17]\d{8}$/.test(text)) text = `0${text}`;
  return normaliseKenyanPhone(text) ?? "invalid";
}

// ---------------------------------------------------------------------------
// Validation (dry run)
// ---------------------------------------------------------------------------

type TenantRow = {
  row: number;
  building: string;
  unitCode: string;
  normalisedCode: string;
  unitType: string | null;
  rent: number;
  depositAmount: number;
  tenantName: string;
  phone: string;
  alternativePhone: string | null;
  nationalId: string | null;
  leaseStart: IsoDate;
  depositHeld: number;
  balance: number;
  lastReading: number | null;
  readingDate: IsoDate | null;
};
type PaymentRow = { row: number; date: IsoDate; normalisedCode: string; amount: number; method: "mpesa" | "bank" | "cash" | "cheque"; reference: string | null; note: string | null };
type ChargeRow = { row: number; month: BillingPeriod; normalisedCode: string; rent: number; water: number; other: number; description: string | null };

export type ImportPreviewUnit = {
  unitCode: string;
  building: string;
  unitIsNew: boolean;
  tenantName: string;
  tenantIsNew: boolean;
  rent: number;
  depositHeld: number;
  balance: number;
  charges: number;
  payments: number;
  chargeRows: number;
  paymentRows: number;
  /** stated balance − (charges − payments); null when the unit has no history rows. */
  difference: number | null;
  lastReading: number | null;
};

export type ImportPreview = {
  fileName: string;
  cutOver: IsoDate;
  openingAsAt: IsoDate;
  counts: {
    buildingsToCreate: number;
    unitsToCreate: number;
    unitsExisting: number;
    tenantsToCreate: number;
    tenantsExisting: number;
    leasesToCreate: number;
    paymentRows: number;
    chargeRows: number;
  };
  buildings: { name: string; codePrefix: string; isNew: boolean; units: number }[];
  units: ImportPreviewUnit[];
  totals: { owed: number; credit: number; depositHeld: number; historyCharges: number; historyPayments: number };
  differences: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

type Plan = {
  preview: ImportPreview;
  tenantRows: TenantRow[];
  paymentRows: PaymentRow[];
  chargeRows: ChargeRow[];
  newBuildings: { name: string; codePrefix: string }[];
};

const METHODS = ["mpesa", "bank", "cash", "cheque"] as const;
const MAX_ISSUES = 300;

/** The 1st of next month (Nairobi), the default cut-over. */
export function defaultCutOver(today: IsoDate): IsoDate {
  const [year, month] = today.split("-").map(Number) as [number, number];
  return month === 12 ? (`${year + 1}-01-01` as IsoDate) : (`${year}-${String(month + 1).padStart(2, "0")}-01` as IsoDate);
}

async function planImport(input: { bytes: ArrayBuffer; fileName: string; cutOver: IsoDate }): Promise<Plan> {
  const cutOver = input.cutOver;
  const openingAsAt = addDays(cutOver, -1);
  const cutOverPeriod = periodOf(cutOver);
  const { sheets, errors: sheetErrors } = await readWorkbook(input.bytes);
  const errors: ImportIssue[] = [...sheetErrors];
  const warnings: ImportIssue[] = [];
  const T = SHEETS.tenants.name;
  const P = SHEETS.payments.name;
  const C = SHEETS.charges.name;
  const issue = (list: ImportIssue[], sheet: string, row: number | null, message: string) => {
    if (list.length < MAX_ISSUES) list.push({ sheet, row, message });
  };

  // ---- Tenants and units ----
  const tenantRows: TenantRow[] = [];
  const seenCodes = new Map<string, number>();
  for (const raw of sheets.tenants ?? []) {
    const v = raw.values;
    const bad = (message: string) => issue(errors, T, raw.row, message);
    const building = readText(v.building ?? null);
    const unitCode = readText(v.unitCode ?? null);
    const tenantName = readText(v.tenantName ?? null);
    if (!building) bad("Building is required");
    if (!unitCode) bad("Unit code is required");
    if (!tenantName) bad("Tenant full name is required");
    const normalisedCode = unitCode ? normaliseUnitCode(unitCode) : "";
    if (unitCode && !/^[A-Z0-9]{1,20}$/.test(normalisedCode)) bad(`Unit code "${unitCode}" can only use letters, numbers, spaces and dashes`);
    let duplicate = false;
    if (normalisedCode) {
      const first = seenCodes.get(normalisedCode);
      if (first) {
        bad(`Unit code ${unitCode} is listed twice (also row ${first})`);
        duplicate = true;
      } else seenCodes.set(normalisedCode, raw.row);
    }

    const money = (key: string, label: string, options: { required?: boolean; allowNegative?: boolean } = {}) => {
      const value = readAmount(v[key] ?? null);
      if (value === null) {
        if (options.required) bad(`${label} is required`);
        return 0;
      }
      if (value === "invalid") {
        bad(`${label} must be a whole number of shillings`);
        return 0;
      }
      if (value < 0 && !options.allowNegative) {
        bad(`${label} can't be negative`);
        return 0;
      }
      return value;
    };
    const rent = money("rent", "Rent", { required: true });
    const depositAmount = money("depositAmount", "Deposit amount");
    const depositHeld = money("depositHeld", "Deposit held");
    const balance = money("balance", "Balance at cut-over", { required: true, allowNegative: true });

    const phone = readPhone(v.phone ?? null);
    if (phone === null) bad("Phone is required");
    else if (phone === "invalid") bad(`Phone "${readText(v.phone ?? null)}" isn't a valid Kenyan mobile number`);
    const alternativePhone = readPhone(v.alternativePhone ?? null);
    if (alternativePhone === "invalid") bad(`Alternative phone "${readText(v.alternativePhone ?? null)}" isn't a valid Kenyan mobile number`);

    const leaseStart = readDate(v.leaseStart ?? null);
    if (leaseStart === null) bad("Lease start date is required");
    else if (leaseStart === "invalid") bad("Lease start date must be a date (YYYY-MM-DD)");
    else if (leaseStart >= cutOver) bad(`Lease start date ${formatDate(leaseStart)} is on or after the cut-over date`);

    let lastReading: number | null = null;
    const reading = readAmount(v.lastReading ?? null);
    if (reading === "invalid") bad("Last meter reading must be a whole number");
    else if (reading !== null && reading < 0) bad("Last meter reading can't be negative");
    else lastReading = reading;
    let readingDate: IsoDate | null = null;
    const readOn = readDate(v.readingDate ?? null);
    if (readOn === "invalid") bad("Reading date must be a date (YYYY-MM-DD)");
    else if (readOn && readOn > cutOver) bad(`Reading date ${formatDate(readOn)} is after the cut-over date`);
    else readingDate = readOn;
    if (lastReading !== null && readingDate === null && readOn !== "invalid") bad("A meter reading needs its reading date");

    const unitType = readText(v.unitType ?? null);
    if (!duplicate && building && unitCode && tenantName && phone && phone !== "invalid" && leaseStart && leaseStart !== "invalid" && leaseStart < cutOver) {
      tenantRows.push({
        row: raw.row,
        building,
        unitCode: unitCode.toUpperCase(),
        normalisedCode,
        unitType,
        rent,
        depositAmount,
        tenantName,
        phone,
        alternativePhone: typeof alternativePhone === "string" ? alternativePhone : null,
        nationalId: readText(v.nationalId ?? null),
        leaseStart,
        depositHeld,
        balance,
        lastReading,
        readingDate,
      });
    }
  }
  if (sheets.tenants && sheets.tenants.length === 0) issue(errors, T, null, "No tenants found: fill in at least one row");

  const codesInFile = new Set(tenantRows.map((row) => row.normalisedCode));
  const unknownUnit = (sheet: string, row: number, code: string | null) => {
    if (!code) issue(errors, sheet, row, "Unit code is required");
    else issue(errors, sheet, row, `Unit code ${code} isn't on the Tenants and units sheet`);
  };

  // ---- Payment history ----
  const paymentRows: PaymentRow[] = [];
  const seenReferences = new Map<string, { sheetRow: number; reference: string }>();
  for (const raw of sheets.payments ?? []) {
    const v = raw.values;
    const bad = (message: string) => issue(errors, P, raw.row, message);
    const date = readDate(v.date ?? null);
    if (date === null) bad("Date is required");
    else if (date === "invalid") bad("Date must be a date (YYYY-MM-DD)");
    else if (date >= cutOver) bad(`Date ${formatDate(date)} is on or after the cut-over date`);
    const code = readText(v.unitCode ?? null);
    const normalisedCode = code ? normaliseUnitCode(code) : "";
    if (!codesInFile.has(normalisedCode)) unknownUnit(P, raw.row, code);
    const amount = readAmount(v.amount ?? null);
    if (amount === null) bad("Amount is required");
    else if (amount === "invalid") bad("Amount must be a whole number of shillings");
    else if (amount <= 0) bad(amount < 0 ? "Amount can't be negative" : "Amount must be more than 0");
    const methodText = readText(v.method ?? null)?.toLowerCase().replace(/[\s-]+/g, "") ?? null;
    const method = METHODS.find((candidate) => candidate === methodText || (candidate === "mpesa" && methodText === "m-pesa"));
    if (!method) bad(methodText ? `Method "${methodText}" must be mpesa, bank, cash or cheque` : "Method is required");
    const reference = readText(v.reference ?? null);
    if (reference) {
      const key = reference.toUpperCase();
      const first = seenReferences.get(key);
      if (first) bad(`Reference ${reference} is used twice in the file (also row ${first.sheetRow})`);
      else seenReferences.set(key, { sheetRow: raw.row, reference });
    }
    if (typeof date === "string" && isIsoDate(date) && codesInFile.has(normalisedCode) && typeof amount === "number" && amount > 0 && method) {
      paymentRows.push({ row: raw.row, date, normalisedCode, amount, method, reference, note: readText(v.note ?? null) });
    }
  }

  // ---- Charges history ----
  const chargeRows: ChargeRow[] = [];
  const seenMonths = new Map<string, number>();
  for (const raw of sheets.charges ?? []) {
    const v = raw.values;
    const bad = (message: string) => issue(errors, C, raw.row, message);
    const month = readMonth(v.month ?? null);
    if (month === null) bad("Month is required");
    else if (month === "invalid") bad("Month must be YYYY-MM");
    else if (month >= cutOverPeriod) bad(`Month ${month} is not before the cut-over month`);
    const code = readText(v.unitCode ?? null);
    const normalisedCode = code ? normaliseUnitCode(code) : "";
    if (!codesInFile.has(normalisedCode)) unknownUnit(C, raw.row, code);
    const amounts = { rent: 0, water: 0, other: 0 };
    for (const key of ["rent", "water", "other"] as const) {
      const value = readAmount(v[key] ?? null);
      if (value === "invalid") bad(`${key[0]!.toUpperCase()}${key.slice(1)} must be a whole number of shillings`);
      else if (value !== null && value < 0) bad(`${key[0]!.toUpperCase()}${key.slice(1)} can't be negative`);
      else amounts[key] = value ?? 0;
    }
    if (amounts.rent + amounts.water + amounts.other === 0) bad("The row charges nothing: fill in rent, water or other");
    if (typeof month === "string" && isBillingPeriod(month) && normalisedCode) {
      const key = `${normalisedCode}:${month}`;
      const first = seenMonths.get(key);
      if (first) bad(`${code} has two rows for ${month} (also row ${first}): combine them`);
      else seenMonths.set(key, raw.row);
    }
    if (typeof month === "string" && isBillingPeriod(month) && month < cutOverPeriod && codesInFile.has(normalisedCode) && amounts.rent + amounts.water + amounts.other > 0) {
      chargeRows.push({ row: raw.row, month, normalisedCode, ...amounts, description: readText(v.description ?? null) });
    }
  }

  // ---- Against the database (one round of parallel queries) ----
  const database = getDatabase();
  const codes = [...codesInFile];
  const phones = [...new Set(tenantRows.map((row) => row.phone))];
  const references = [...seenReferences.values()].map((item) => item.reference);
  const [existingUnits, existingBuildings, existingTenants, existingReferences] = await Promise.all([
    codes.length
      ? database
          .select({
            id: units.id,
            code: units.code,
            normalisedCode: units.normalisedCode,
            buildingName: buildings.name,
            current: sql<number>`(select count(*) from leases l where l.unit_id = ${units.id} and l.status <> 'ended')::int`,
          })
          .from(units)
          .innerJoin(buildings, eq(buildings.id, units.buildingId))
          .where(inArray(units.normalisedCode, codes))
      : [],
    database.select({ id: buildings.id, name: buildings.name, codePrefix: buildings.codePrefix }).from(buildings),
    phones.length ? database.select({ phone: tenants.phone, fullName: tenants.fullName }).from(tenants).where(inArray(tenants.phone, phones)) : [],
    references.length
      ? database
          .select({ mpesaReceipt: payments.mpesaReceipt, reference: sql<string | null>`${payments.raw}->>'reference'` })
          .from(payments)
          .where(
            and(
              ne(payments.matchStatus, "reversed"),
              or(
                inArray(sql`upper(${payments.mpesaReceipt})`, references.map((item) => item.toUpperCase())),
                inArray(sql`upper(${payments.raw}->>'reference')`, references.map((item) => item.toUpperCase())),
              ),
            ),
          )
      : [],
  ]);

  const usedReferences = new Set(existingReferences.flatMap((row) => [row.mpesaReceipt, row.reference]).filter((value): value is string => !!value).map((value) => value.toUpperCase()));
  for (const row of paymentRows) {
    if (row.reference && usedReferences.has(row.reference.toUpperCase())) {
      issue(errors, P, row.row, `Reference ${row.reference} is already recorded as a payment`);
    }
  }

  const unitByCode = new Map(existingUnits.map((unit) => [unit.normalisedCode ?? normaliseUnitCode(unit.code), unit]));
  const buildingByName = new Map(existingBuildings.map((building) => [building.name.trim().toLowerCase(), building]));
  const tenantByPhone = new Map(existingTenants.map((tenant) => [tenant.phone, tenant]));
  for (const row of tenantRows) {
    const unit = unitByCode.get(row.normalisedCode);
    if (unit) {
      if (unit.current > 0) issue(errors, T, row.row, `Unit ${unit.code} already has a current tenant`);
      if (unit.buildingName.trim().toLowerCase() !== row.building.trim().toLowerCase()) {
        issue(errors, T, row.row, `Unit ${unit.code} already exists in ${unit.buildingName}, not ${row.building}`);
      }
    } else if (!row.unitType) {
      issue(errors, T, row.row, `Unit type is required for the new unit ${row.unitCode}`);
    }
    const tenant = tenantByPhone.get(row.phone);
    if (tenant && tenant.fullName.trim().toLowerCase() !== row.tenantName.trim().toLowerCase()) {
      issue(warnings, T, row.row, `${row.phone.replace(/^254/, "0")} belongs to ${tenant.fullName}; the lease will be added to that tenant`);
    }
  }
  // Same phone with different names inside the file.
  const nameByPhone = new Map<string, TenantRow>();
  for (const row of tenantRows) {
    const first = nameByPhone.get(row.phone);
    if (first && first.tenantName.trim().toLowerCase() !== row.tenantName.trim().toLowerCase()) {
      issue(errors, T, row.row, `Phone ${row.phone.replace(/^254/, "0")} is also on row ${first.row} for ${first.tenantName}`);
    } else if (!first) nameByPhone.set(row.phone, row);
  }

  // ---- New buildings and their code prefixes ----
  const usedPrefixes = new Set(existingBuildings.map((building) => building.codePrefix));
  const newBuildings: { name: string; codePrefix: string }[] = [];
  const buildingSummary = new Map<string, { name: string; codePrefix: string; isNew: boolean; units: number }>();
  for (const row of tenantRows) {
    const key = row.building.trim().toLowerCase();
    let summary = buildingSummary.get(key);
    if (!summary) {
      const existing = buildingByName.get(key);
      if (existing) {
        summary = { name: existing.name, codePrefix: existing.codePrefix, isNew: false, units: 0 };
      } else {
        const fromCode = /^([A-Za-z]+)[\s-]/.exec(row.unitCode)?.[1];
        const base = normaliseUnitCode(fromCode ?? row.building.replace(/[^A-Za-z]/g, "").slice(0, 3)).slice(0, 6) || "BLD";
        let prefix = base;
        for (let n = 2; usedPrefixes.has(prefix); n++) prefix = `${base}${n}`;
        usedPrefixes.add(prefix);
        summary = { name: row.building.trim(), codePrefix: prefix, isNew: true, units: 0 };
        newBuildings.push({ name: summary.name, codePrefix: prefix });
      }
      buildingSummary.set(key, summary);
    }
    summary.units += 1;
  }

  // ---- Per-unit preview ----
  const previewUnits: ImportPreviewUnit[] = tenantRows.map((row) => {
    const unitCharges = chargeRows.filter((charge) => charge.normalisedCode === row.normalisedCode);
    const unitPayments = paymentRows.filter((payment) => payment.normalisedCode === row.normalisedCode);
    const charged = sumShillings(unitCharges.map((charge) => charge.rent + charge.water + charge.other));
    const paid = sumShillings(unitPayments.map((payment) => payment.amount));
    const hasHistory = unitCharges.length + unitPayments.length > 0;
    const difference = hasHistory ? row.balance - (charged - paid) : null;
    return {
      unitCode: unitByCode.get(row.normalisedCode)?.code ?? row.unitCode,
      building: buildingSummary.get(row.building.trim().toLowerCase())?.name ?? row.building,
      unitIsNew: !unitByCode.has(row.normalisedCode),
      tenantName: tenantByPhone.get(row.phone)?.fullName ?? row.tenantName,
      tenantIsNew: !tenantByPhone.has(row.phone),
      rent: row.rent,
      depositHeld: row.depositHeld,
      balance: row.balance,
      charges: charged,
      payments: paid,
      chargeRows: unitCharges.length,
      paymentRows: unitPayments.length,
      difference: difference === 0 ? 0 : difference,
      lastReading: row.lastReading,
    };
  });

  const newPhones = new Set(tenantRows.filter((row) => !tenantByPhone.has(row.phone)).map((row) => row.phone));
  const preview: ImportPreview = {
    fileName: input.fileName,
    cutOver,
    openingAsAt,
    counts: {
      buildingsToCreate: newBuildings.length,
      unitsToCreate: previewUnits.filter((unit) => unit.unitIsNew).length,
      unitsExisting: previewUnits.filter((unit) => !unit.unitIsNew).length,
      tenantsToCreate: newPhones.size,
      tenantsExisting: new Set(tenantRows.filter((row) => tenantByPhone.has(row.phone)).map((row) => row.phone)).size,
      leasesToCreate: tenantRows.length,
      paymentRows: paymentRows.length,
      chargeRows: chargeRows.length,
    },
    buildings: [...buildingSummary.values()],
    units: previewUnits,
    totals: {
      owed: sumShillings(tenantRows.filter((row) => row.balance > 0).map((row) => row.balance)),
      credit: sumShillings(tenantRows.filter((row) => row.balance < 0).map((row) => -row.balance)),
      depositHeld: sumShillings(tenantRows.map((row) => row.depositHeld)),
      historyCharges: sumShillings(previewUnits.map((unit) => unit.charges)),
      historyPayments: sumShillings(previewUnits.map((unit) => unit.payments)),
    },
    differences: previewUnits.filter((unit) => unit.difference !== null && unit.difference !== 0).length,
    errors,
    warnings,
  };
  return { preview, tenantRows, paymentRows, chargeRows, newBuildings };
}

/** Reads and checks the workbook against the database. Writes nothing. */
export async function dryRunImport(input: { bytes: ArrayBuffer; fileName: string; cutOver: IsoDate }): Promise<ImportPreview> {
  if (!isIsoDate(input.cutOver)) throw new ServiceError("Choose a cut-over date");
  return (await planImport(input)).preview;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const CHANNEL_FOR_METHOD = { mpesa: "paybill", bank: "bank", cash: "cash", cheque: "cheque" } as const;

async function importUnit(
  transaction: Transaction,
  input: { row: TenantRow; buildingId: string; batchId: string; cutOver: IsoDate; payments: PaymentRow[]; charges: ChargeRow[] },
): Promise<{ leaseId: string; unitCode: string; tenantCreated: boolean; unitCreated: boolean; phone: string }> {
  const { row, cutOver } = input;
  const asAt = addDays(cutOver, -1);
  const asAtLabel = `Opening balance as at ${formatDate(asAt)}`;

  // Unit: existing (must be free) or new.
  const [existingUnit] = await transaction
    .select({ id: units.id, code: units.code, status: units.status })
    .from(units)
    .where(eq(units.normalisedCode, row.normalisedCode))
    .for("update");
  let unitId: string;
  let unitCode: string;
  let unitCreated = false;
  if (existingUnit) {
    const [current] = await transaction
      .select({ id: leases.id })
      .from(leases)
      .where(and(eq(leases.unitId, existingUnit.id), ne(leases.status, "ended")))
      .limit(1);
    if (current) throw new ServiceError(`Unit ${existingUnit.code} already has a current tenant`);
    unitId = existingUnit.id;
    unitCode = existingUnit.code;
    await transaction.update(units).set({ status: "occupied" }).where(eq(units.id, unitId));
  } else {
    const [created] = await transaction
      .insert(units)
      .values({
        buildingId: input.buildingId,
        code: row.unitCode,
        type: row.unitType ?? "Unit",
        rentAmount: row.rent,
        depositAmount: row.depositAmount,
        status: "occupied",
      })
      .returning({ id: units.id, code: units.code });
    if (!created) throw new Error("Unit insert returned no row");
    unitId = created.id;
    unitCode = created.code;
    unitCreated = true;
  }

  // Tenant: by phone, or new.
  const [existingTenant] = await transaction.select({ id: tenants.id }).from(tenants).where(eq(tenants.phone, row.phone));
  let tenantId: string;
  let tenantCreated = false;
  if (existingTenant) {
    tenantId = existingTenant.id;
  } else {
    const [created] = await transaction
      .insert(tenants)
      .values({ fullName: row.tenantName, phone: row.phone, alternativePhone: row.alternativePhone, nationalId: row.nationalId })
      .returning({ id: tenants.id });
    if (!created) throw new Error("Tenant insert returned no row");
    tenantId = created.id;
    tenantCreated = true;
  }

  const [lease] = await transaction
    .insert(leases)
    .values({ tenantId, unitId, startDate: row.leaseStart, rentAmount: row.rent, depositAmount: row.depositAmount, status: "active" })
    .returning({ id: leases.id });
  if (!lease) throw new Error("Lease insert returned no row");
  const leaseId = lease.id;

  // Opening balance (owed) and deposit held become an "opening" invoice: lines so payments allocate to them.
  const owed = Math.max(0, row.balance);
  const credit = Math.max(0, -row.balance);
  const lines: { type: "other" | "deposit"; description: string; amount: number }[] = [];
  if (owed > 0) lines.push({ type: "other", description: asAtLabel, amount: owed });
  if (row.depositHeld > 0) lines.push({ type: "deposit", description: "Deposit held at cut-over", amount: row.depositHeld });
  if (lines.length > 0) {
    const [invoice] = await transaction
      .insert(invoices)
      .values({
        leaseId,
        period: periodOf(asAt),
        number: `OPEN-${row.normalisedCode}-${asAt.replace(/-/g, "")}`,
        issueDate: asAt,
        dueDate: cutOver,
        total: sumShillings(lines.map((line) => line.amount)),
        source: "opening",
        importBatchId: input.batchId,
      })
      .returning({ id: invoices.id, number: invoices.number });
    if (!invoice) throw new Error("Opening invoice insert returned no row");
    const inserted = await transaction
      .insert(invoiceLines)
      .values(lines.map((line) => ({ invoiceId: invoice.id, type: line.type, description: line.description, quantity: 1, rate: line.amount, amount: line.amount })))
      .returning({ id: invoiceLines.id, type: invoiceLines.type, amount: invoiceLines.amount });
    for (const line of inserted) {
      await transaction.insert(ledgerEntries).values({
        leaseId,
        entryDate: asAt,
        type: "charge",
        account: "rent",
        reference: line.type === "deposit" ? "Deposit held at cut-over" : asAtLabel,
        debit: line.amount,
        credit: 0,
        invoiceLineId: line.id,
      });
    }
    // The deposit is already held: record it as paid against its line (nets to zero in the balance).
    const depositLine = inserted.find((line) => line.type === "deposit");
    if (depositLine) {
      const [payment] = await transaction
        .insert(payments)
        .values({
          channel: "opening",
          amount: depositLine.amount,
          accountReference: unitCode,
          paidAt: startOfNairobiDay(asAt),
          leaseId,
          matchStatus: "matched",
          source: "opening",
          importBatchId: input.batchId,
          raw: { note: "Deposit held at cut-over" },
        })
        .returning({ id: payments.id });
      if (!payment) throw new Error("Deposit payment insert returned no row");
      await transaction.insert(ledgerEntries).values({
        leaseId,
        entryDate: asAt,
        type: "payment",
        account: "rent",
        reference: "Deposit held at cut-over",
        debit: 0,
        credit: depositLine.amount,
        paymentId: payment.id,
      });
      await transaction.insert(allocations).values({ paymentId: payment.id, invoiceLineId: depositLine.id, amount: depositLine.amount });
    }
  }
  // Opening credit: an unallocated "opening" payment, so it pays future bills like any credit.
  if (credit > 0) {
    const [payment] = await transaction
      .insert(payments)
      .values({
        channel: "opening",
        amount: credit,
        accountReference: unitCode,
        paidAt: startOfNairobiDay(asAt),
        leaseId,
        matchStatus: "matched",
        source: "opening",
        importBatchId: input.batchId,
        raw: { note: asAtLabel },
      })
      .returning({ id: payments.id });
    if (!payment) throw new Error("Opening credit insert returned no row");
    await transaction.insert(ledgerEntries).values({ leaseId, entryDate: asAt, type: "payment", account: "rent", reference: asAtLabel, debit: 0, credit, paymentId: payment.id });
  }

  // Last meter reading, confirmed, so the first water bill starts from it.
  if (row.lastReading !== null && row.readingDate) {
    const reading = {
      unitId,
      period: periodOf(row.readingDate),
      kind: "opening" as const,
      previousReading: row.lastReading,
      currentReading: row.lastReading,
      readOn: row.readingDate,
      flagged: false,
      confirmed: true,
    };
    await transaction
      .insert(meterReadings)
      .values(reading)
      .onConflictDoUpdate({ target: [meterReadings.unitId, meterReadings.period, meterReadings.kind], set: reading });
  }

  // History: kept for the record only. No invoice lines, ledger entries, allocations, receipts or SMS.
  if (input.charges.length > 0) {
    await transaction.insert(invoices).values(
      input.charges.map((charge) => ({
        leaseId,
        period: charge.month,
        number: `IMP-${charge.month.replace("-", "")}-${row.normalisedCode}`,
        issueDate: firstDayOfPeriod(charge.month),
        dueDate: firstDayOfPeriod(charge.month),
        total: charge.rent + charge.water + charge.other,
        source: "import" as const,
        history: { rent: charge.rent, water: charge.water, other: charge.other, description: charge.description },
        importBatchId: input.batchId,
      })),
    );
  }
  if (input.payments.length > 0) {
    await transaction.insert(payments).values(
      input.payments.map((payment) => ({
        // M-Pesa codes go in mpesa_receipt, so a later Paybill callback or statement row with the same code is a duplicate.
        mpesaReceipt: payment.method === "mpesa" && payment.reference ? payment.reference.toUpperCase() : null,
        channel: CHANNEL_FOR_METHOD[payment.method],
        amount: payment.amount,
        accountReference: unitCode,
        paidAt: startOfNairobiDay(payment.date),
        leaseId,
        matchStatus: "imported" as const,
        source: "import" as const,
        importBatchId: input.batchId,
        raw: { method: payment.method, reference: payment.reference, note: payment.note },
      })),
    );
  }

  return { leaseId, unitCode, tenantCreated, unitCreated, phone: row.phone };
}

/** Runs `work` over items with at most `limit` running at once (each unit is its own transaction). */
async function inBatches<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

export type ImportResult = {
  batchId: string;
  imported: number;
  failed: { unitCode: string; message: string }[];
  sms: { sent: number; skipped: number; failed: number } | null;
};

/**
 * Imports the workbook: one transaction per unit. Refuses if the dry run finds errors, or if there are
 * differences between history and stated balances that haven't been confirmed.
 */
export async function runImport(input: {
  bytes: ArrayBuffer;
  fileName: string;
  cutOver: IsoDate;
  differencesChecked: boolean;
  textTenants: boolean;
  actor: string;
}): Promise<ImportResult> {
  if (!isIsoDate(input.cutOver)) throw new ServiceError("Choose a cut-over date");
  const plan = await planImport(input);
  const { preview } = plan;
  if (preview.errors.length > 0) throw new ServiceError(`The file has ${preview.errors.length} problem${preview.errors.length === 1 ? "" : "s"}. Check it again and fix them first.`);
  if (preview.differences > 0 && !input.differencesChecked) throw new ServiceError("Tick “I've checked the differences” to import");

  const database = getDatabase();
  const [batch] = await database
    .insert(importBatches)
    .values({ fileName: input.fileName, cutOverDate: input.cutOver, actor: input.actor })
    .returning({ id: importBatches.id });
  if (!batch) throw new Error("Import batch insert returned no row");

  // Buildings first (shared by several units).
  const buildingIds = new Map<string, string>();
  const allBuildings = await database.select({ id: buildings.id, name: buildings.name }).from(buildings);
  for (const building of allBuildings) buildingIds.set(building.name.trim().toLowerCase(), building.id);
  for (const building of plan.newBuildings) {
    const key = building.name.trim().toLowerCase();
    if (buildingIds.has(key)) continue;
    const [created] = await database.insert(buildings).values({ name: building.name, codePrefix: building.codePrefix }).returning({ id: buildings.id });
    if (created) buildingIds.set(key, created.id);
  }

  const outcomes = await inBatches(plan.tenantRows, 4, async (row) => {
    try {
      const result = await database.transaction((transaction) =>
        importUnit(transaction, {
          row,
          buildingId: buildingIds.get(row.building.trim().toLowerCase()) as string,
          batchId: batch.id,
          cutOver: input.cutOver,
          payments: plan.paymentRows.filter((payment) => payment.normalisedCode === row.normalisedCode),
          charges: plan.chargeRows.filter((charge) => charge.normalisedCode === row.normalisedCode),
        }),
      );
      return { ok: true as const, row, result };
    } catch (error) {
      console.error(`[import] unit ${row.unitCode} failed`, error);
      return { ok: false as const, row, message: error instanceof ServiceError ? error.message : "Could not be saved" };
    }
  });
  const done = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => ({ unitCode: outcome.row.unitCode, message: outcome.message }));

  const counts = {
    units: done.length,
    unitsCreated: done.filter((outcome) => outcome.result.unitCreated).length,
    tenantsCreated: done.filter((outcome) => outcome.result.tenantCreated).length,
    buildingsCreated: plan.newBuildings.length,
    leases: done.length,
    historyPayments: done.reduce((total, outcome) => total + plan.paymentRows.filter((payment) => payment.normalisedCode === outcome.row.normalisedCode).length, 0),
    historyCharges: done.reduce((total, outcome) => total + plan.chargeRows.filter((charge) => charge.normalisedCode === outcome.row.normalisedCode).length, 0),
    owed: sumShillings(done.map((outcome) => Math.max(0, outcome.row.balance))),
    credit: sumShillings(done.map((outcome) => Math.max(0, -outcome.row.balance))),
    depositHeld: sumShillings(done.map((outcome) => outcome.row.depositHeld)),
    differences: preview.differences,
    failed: failed.length,
  };

  await database.transaction(async (transaction) => {
    await transaction
      .update(importBatches)
      .set({ unitsImported: done.length, counts, finishedAt: done.length > 0 ? new Date() : null })
      .where(eq(importBatches.id, batch.id));
    await writeAudit(transaction, {
      actor: input.actor,
      action: "import.opening_balances",
      entity: "import_batch",
      entityId: batch.id,
      after: { fileName: input.fileName, cutOver: input.cutOver, counts, failed, textTenants: input.textTenants },
    });
  });

  let sms: ImportResult["sms"] = null;
  if (input.textTenants && done.length > 0) {
    sms = { sent: 0, skipped: 0, failed: 0 };
    const appName = getEnvironment().APP_NAME;
    const [owner] = await database.select({ phone: landlord.phone }).from(landlord).limit(1);
    const call = owner?.phone ? `0${owner.phone.replace(/^254/, "")}` : null;
    const results = await inBatches(done, 4, async (outcome) => {
      const balance = outcome.row.balance;
      const word = balance > 0 ? " owed" : balance < 0 ? " credit" : "";
      const body =
        `Your account for ${outcome.result.unitCode} is now on ${appName}. Opening balance ${formatShillings(Math.abs(balance))}${word}.` +
        (call ? ` Questions? Call ${call}` : "");
      return (await sendSms({ to: outcome.result.phone, body, template: "opening_balance", leaseId: outcome.result.leaseId, relatedId: batch.id })).status;
    });
    for (const status of results) sms[status] += 1;
  }

  return { batchId: batch.id, imported: done.length, failed, sms };
}
