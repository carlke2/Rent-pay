"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { importOpeningBalancesAction } from "@/app/admin/actions/imports";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import { useServerForm } from "@/components/shared/use-server-form";
import type { ImportIssue, ImportPreview, ImportResult } from "@/services/imports";
import { cn } from "@/utilities/class-names";

const money = (value: number) => `KES ${Math.abs(value).toLocaleString("en-KE")}`;
const signed = (value: number) => (value < 0 ? `−${money(value)}` : money(value));
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** Settings → Import: download the template, upload it, dry run (preview), then import. */
export function ImportScreen({ defaultCutOver }: { defaultCutOver: string }) {
  const { state, pending, onSubmit } = useServerForm(importOpeningBalancesAction);
  const lastAt = useRef<number | undefined>(undefined);
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [cutOver, setCutOver] = useState(defaultCutOver);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [differencesChecked, setDifferencesChecked] = useState(false);
  const [intent, setIntent] = useState<"check" | "import">("check");

  const currentKey = fileKey ? `${fileKey}|${cutOver}` : null;

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    const data = state.data as { kind?: string; preview?: ImportPreview; result?: ImportResult } | undefined;
    if (state.status === "success" && data?.kind === "preview" && data.preview) {
      setPreview(data.preview);
      setResult(null);
      setCheckedKey(currentKey);
      setDifferencesChecked(false);
      if (data.preview.errors.length) toast.error(state.message);
      else toast.success(state.message);
    } else if (state.status === "success" && data?.kind === "result" && data.result) {
      setResult(data.result);
      setPreview(null);
      setCheckedKey(null);
      if (data.result.failed.length) toast.warning(state.message);
      else toast.success(state.message);
    } else if (state.status === "error" && state.message) {
      toast.error(state.message);
    }
    // currentKey is read at the moment the response arrives, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const previewIsCurrent = preview !== null && checkedKey === currentKey;
  const canImport = previewIsCurrent && preview.errors.length === 0 && (preview.differences === 0 || differencesChecked);
  const fieldError = (name: string) => (state.status === "error" ? state.fieldErrors?.[name] : undefined);

  return (
    <div className="grid gap-6">
      <section className="rounded-[14px] border bg-card p-5">
        <h2 className="text-base font-semibold text-heading">1. Fill in the template</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Three sheets: <strong>Tenants and units</strong> (required), <strong>Payment history</strong> and <strong>Charges history</strong> (optional). Hover a column heading in
          Excel for what goes in it.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4 text-foreground">
          <a href="/admin/settings/import/template" className="no-underline" download>
            <Download aria-hidden /> Download template (.xlsx)
          </a>
        </Button>
      </section>

      <form onSubmit={onSubmit} noValidate className="rounded-[14px] border bg-card p-5">
        <h2 className="text-base font-semibold text-heading">2. Upload and check</h2>
        <p className="mt-1 text-sm text-muted-foreground">Checking reads every row and shows what would be created. Nothing is saved until you press Import.</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="import-file">Filled-in template</Label>
            <Input
              id="import-file"
              name="file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              aria-invalid={Boolean(fieldError("file")) || undefined}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                setFileKey(file ? `${file.name}:${file.size}:${file.lastModified}` : null);
              }}
            />
            {fieldError("file") ? <p className="text-xs font-medium text-destructive">{fieldError("file")}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="import-cut-over">Cut-over date</Label>
            <Input id="import-cut-over" name="cutOver" type="date" required value={cutOver} onChange={(event) => setCutOver(event.currentTarget.value)} />
            <p className="text-xs text-muted-foreground">
              The first day the app keeps the books. Balances are as at the day before{cutOver ? ` (${shortDate(addDaysIso(cutOver, -1))})` : ""}; earlier periods are closed.
            </p>
            {fieldError("cutOver") ? <p className="text-xs font-medium text-destructive">{fieldError("cutOver")}</p> : null}
          </div>
        </div>

        <label className="mt-4 flex min-h-11 items-start gap-2.5 text-sm">
          <input type="checkbox" name="textTenants" className="mt-0.5 size-5 accent-[var(--brand,#111)]" />
          <span>
            Text each tenant their opening balance
            <span className="block text-xs text-muted-foreground">“Your account for A1 is now on the app. Opening balance KES 2,000 owed. Questions? Call …” Not sent between 21:00 and 07:00.</span>
          </span>
        </label>

        {previewIsCurrent && preview.differences > 0 && preview.errors.length === 0 ? (
          <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <input
              type="checkbox"
              name="differencesChecked"
              checked={differencesChecked}
              onChange={(event) => setDifferencesChecked(event.currentTarget.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              I&apos;ve checked the differences
              <span className="block text-xs text-muted-foreground">
                For {preview.differences} unit{preview.differences === 1 ? "" : "s"}, charges minus payments in the history don&apos;t match the stated balance. The stated balance is what gets
                imported.
              </span>
            </span>
          </label>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="submit" name="intent" value="check" variant="outline" className="text-foreground" disabled={pending} onClick={() => setIntent("check")}>
            {pending && intent === "check" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Check file
          </Button>
          <Button type="submit" name="intent" value="import" disabled={pending || !canImport} onClick={() => setIntent("import")} aria-busy={pending && intent === "import"}>
            {pending && intent === "import" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Import
          </Button>
        </div>
        {preview && !previewIsCurrent ? <p className="mt-2 text-right text-xs text-muted-foreground">The file or date changed: check it again before importing.</p> : null}
      </form>

      {result ? <ResultPanel result={result} /> : null}
      {preview ? <PreviewPanel preview={preview} stale={!previewIsCurrent} /> : null}
    </div>
  );
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numbers mt-1 text-lg font-semibold text-heading tabular-nums">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: ImportIssue[]; tone: "error" | "warning" }) {
  if (issues.length === 0) return null;
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className={cn("rounded-xl border p-4", tone === "error" ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/10")}>
      <p className={cn("flex items-center gap-2 text-sm font-semibold", tone === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
        <Icon className="size-4" aria-hidden /> {title} ({issues.length}
        {issues.length >= 300 ? "+" : ""})
      </p>
      <ul className="mt-2 grid max-h-72 gap-1 overflow-y-auto text-sm">
        {issues.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">
              {item.sheet}
              {item.row ? `, row ${item.row}` : ""}:
            </span>
            <span className="min-w-0">{item.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewPanel({ preview, stale }: { preview: ImportPreview; stale: boolean }) {
  const { counts, totals } = preview;
  return (
    <section aria-label="Import preview" className={cn("grid gap-4 rounded-[14px] border bg-card p-5", stale && "opacity-60")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-heading">3. Preview{stale ? " (out of date)" : ""}</h2>
        <p className="text-sm text-muted-foreground">
          {preview.fileName} · cut-over {shortDate(preview.cutOver)} · balances as at {shortDate(preview.openingAsAt)}
        </p>
      </div>

      {preview.errors.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden /> No problems found. Nothing has been saved yet.
        </p>
      ) : null}
      <IssueList title="Fix these in the file, then check again" issues={preview.errors} tone="error" />
      <IssueList title="Worth a look" issues={preview.warnings} tone="warning" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Buildings to create" value={counts.buildingsToCreate} note={`${preview.buildings.length - counts.buildingsToCreate} existing`} />
        <Stat label="Units to create" value={counts.unitsToCreate} note={`${counts.unitsExisting} existing, vacant`} />
        <Stat label="Tenants to create" value={counts.tenantsToCreate} note={`${counts.tenantsExisting} already known`} />
        <Stat label="Leases to create" value={counts.leasesToCreate} />
        <Stat label="Opening balances owed" value={money(totals.owed)} />
        <Stat label="Opening credit" value={money(totals.credit)} />
        <Stat label="History charges" value={money(totals.historyCharges)} note={`${counts.chargeRows} rows`} />
        <Stat label="History payments" value={money(totals.historyPayments)} note={`${counts.paymentRows} rows`} />
      </div>

      {preview.buildings.length ? (
        <p className="text-sm text-muted-foreground">
          {preview.buildings.map((building, index) => (
            <span key={building.name}>
              {index ? " · " : ""}
              <span className="font-medium text-foreground">{building.name}</span> ({building.isNew ? `new, prefix ${building.codePrefix}` : "existing"}, {building.units} unit
              {building.units === 1 ? "" : "s"})
            </span>
          ))}
        </p>
      ) : null}

      {preview.units.length ? (
        <ul className="grid gap-3 md:hidden">
          {preview.units.map((unit) => (
            <li key={unit.unitCode} className={cn("rounded-xl border p-4 text-sm", unit.difference ? "border-amber-500/40 bg-amber-500/5" : undefined)}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-heading">
                  {unit.unitCode}
                  {unit.unitIsNew ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">new</span> : null}
                </span>
                <span className="numbers shrink-0 font-semibold">{unit.balance < 0 ? `${money(unit.balance)} credit` : money(unit.balance)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted-foreground">
                <dt>Tenant</dt>
                <dd className="truncate text-right text-foreground">{unit.tenantName}</dd>
                <dt>Building</dt>
                <dd className="truncate text-right">{unit.building}</dd>
                <dt>Rent</dt>
                <dd className="numbers text-right">{money(unit.rent)}</dd>
                <dt>Deposit held</dt>
                <dd className="numbers text-right">{unit.depositHeld ? money(unit.depositHeld) : "–"}</dd>
                <dt>Charges / payments</dt>
                <dd className="numbers text-right">{unit.chargeRows || unit.paymentRows ? `${money(unit.charges)} / ${money(unit.payments)}` : "–"}</dd>
                <dt>Difference</dt>
                <dd className={cn("numbers text-right", unit.difference ? "font-semibold text-amber-700 dark:text-amber-400" : undefined)}>
                  {unit.difference === null ? "no history" : unit.difference === 0 ? "matches" : signed(unit.difference)}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
      {preview.units.length ? (
        <div className="hidden overflow-x-auto rounded-xl border md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Unit</th>
                <th scope="col" className="px-3 py-2 font-medium">Tenant</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Rent</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Deposit held</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Charges</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Payments</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Stated balance</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {preview.units.map((unit) => (
                <tr key={unit.unitCode} className={cn(unit.difference ? "bg-amber-500/5" : undefined)}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-heading">{unit.unitCode}</span>
                    {unit.unitIsNew ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">new</span> : null}
                    <span className="block text-xs text-muted-foreground">{unit.building}</span>
                  </td>
                  <td className="px-3 py-2">
                    {unit.tenantName}
                    {!unit.tenantIsNew ? <span className="block text-xs text-muted-foreground">existing tenant</span> : null}
                  </td>
                  <td className="numbers px-3 py-2 text-right tabular-nums">{money(unit.rent)}</td>
                  <td className="numbers px-3 py-2 text-right tabular-nums">{unit.depositHeld ? money(unit.depositHeld) : "–"}</td>
                  <td className="numbers px-3 py-2 text-right tabular-nums">{unit.chargeRows ? money(unit.charges) : "–"}</td>
                  <td className="numbers px-3 py-2 text-right tabular-nums">{unit.paymentRows ? money(unit.payments) : "–"}</td>
                  <td className="numbers px-3 py-2 text-right font-medium tabular-nums">
                    {unit.balance < 0 ? `${money(unit.balance)} credit` : money(unit.balance)}
                  </td>
                  <td
                    className={cn(
                      "numbers px-3 py-2 text-right tabular-nums",
                      unit.difference ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    {unit.difference === null ? "no history" : unit.difference === 0 ? "matches" : signed(unit.difference)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Difference = stated balance − (charges − payments). History is kept for the record only; the stated balance is what the tenant owes.</p>
    </section>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  return (
    <section aria-label="Import result" className="grid gap-3 rounded-[14px] border bg-card p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-heading">
        <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Imported {result.imported} unit{result.imported === 1 ? "" : "s"}
      </h2>
      {result.sms ? (
        <p className="text-sm text-muted-foreground">
          Opening-balance SMS: {result.sms.sent} sent{result.sms.skipped ? `, ${result.sms.skipped} skipped (quiet hours)` : ""}
          {result.sms.failed ? `, ${result.sms.failed} failed` : ""}.
        </p>
      ) : null}
      {result.failed.length ? (
        <IssueList
          title="These units were not imported (nothing was saved for them)"
          issues={result.failed.map((item) => ({ sheet: item.unitCode, row: null, message: item.message }))}
          tone="error"
        />
      ) : null}
    </section>
  );
}
