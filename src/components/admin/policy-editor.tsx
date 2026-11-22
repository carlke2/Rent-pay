"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { previewPolicyAction, savePolicyAction } from "@/app/admin/actions/settings";
import { selectClassName } from "@/components/shared/action-types";
import { useServerForm } from "@/components/shared/use-server-form";
import { FieldError } from "@/components/shared/action-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shared/ui/alert-dialog";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import type { PolicySettings } from "@/core/policy";

const ORDER_LABELS: Record<string, string> = { rent: "Rent", water: "Water", fixed: "Fixed charges", penalty: "Late fees", other: "Other charges" };

function NumberInput({ id, label, value, onChange, error, suffix }: { id: string; label: string; value: number; onChange: (value: number) => void; error?: string; suffix?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="numeric" value={Number.isNaN(value) ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value.replace(/[^\d.]/g, "")))} aria-invalid={Boolean(error) || undefined} />
        {suffix ? <span className="text-sm whitespace-nowrap text-muted-foreground">{suffix}</span> : null}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <legend className="font-semibold">{title}</legend>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}

/** Edits a full policy. Preview shows the impact; Save creates a new policy row from the effective date. */
export function PolicyEditor({ scope, initial, today, scopeLabel }: { scope: string; initial: PolicySettings; today: string; scopeLabel: string }) {
  const [settings, setSettings] = useState<PolicySettings>(initial);
  const { state: previewState, pending: previewing, submit: submitPreview } = useServerForm(previewPolicyAction);
  const { state: saveState, pending: saving, submit: submitSave } = useServerForm(savePolicyAction);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(0);
  const errors = { ...previewState.fieldErrors, ...saveState.fieldErrors };
  const error = (path: string) => errors[`settings.${path}`];

  useEffect(() => {
    for (const state of [previewState, saveState]) {
      if (!state.at || state.at <= seen.current) continue;
      seen.current = state.at;
      if (state.message) (state.status === "success" ? toast.success : toast.error)(state.message);
    }
  }, [previewState, saveState]);

  const set = <Key extends keyof PolicySettings>(key: Key, value: PolicySettings[Key]) => setSettings((current) => ({ ...current, [key]: value }));
  const move = (index: number, direction: -1 | 1) => {
    const order = [...settings.allocationOrder];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target] as (typeof order)[number], order[index] as (typeof order)[number]];
    set("allocationOrder", order);
  };

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="grid gap-6 rounded-xl border bg-card p-4 sm:p-6" noValidate>
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="settings" value={JSON.stringify(settings)} />

      <Section title="Due date and grace">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput id="dueDay" label="Rent due on day" value={settings.dueDay} onChange={(value) => set("dueDay", value)} error={error("dueDay")} suffix="of the month" />
          <NumberInput id="graceDays" label="Grace period" value={settings.graceDays} onChange={(value) => set("graceDays", value)} error={error("graceDays")} suffix="days" />
        </div>
      </Section>

      <Section title="Late payment penalty" description="Charged after the grace period on unpaid rent.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="penaltyType">Penalty</Label>
            <select id="penaltyType" className={selectClassName} value={settings.penalty.type} onChange={(event) => set("penalty", { ...settings.penalty, type: event.target.value as PolicySettings["penalty"]["type"] })}>
              <option value="none">No penalty</option>
              <option value="flat">Fixed amount</option>
              <option value="percent">Percentage of overdue rent</option>
            </select>
          </div>
          {settings.penalty.type !== "none" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="penaltyRepeat">How often</Label>
              <select id="penaltyRepeat" className={selectClassName} value={settings.penalty.repeat} onChange={(event) => set("penalty", { ...settings.penalty, repeat: event.target.value as "once" | "monthly" })}>
                <option value="once">Once per invoice</option>
                <option value="monthly">Every month while unpaid</option>
              </select>
            </div>
          ) : null}
          {settings.penalty.type === "flat" ? (
            <NumberInput id="penaltyAmount" label="Amount" value={settings.penalty.amount} onChange={(value) => set("penalty", { ...settings.penalty, amount: value })} error={error("penalty.amount")} suffix="KES" />
          ) : null}
          {settings.penalty.type === "percent" ? (
            <NumberInput id="penaltyPercent" label="Percentage" value={settings.penalty.percent} onChange={(value) => set("penalty", { ...settings.penalty, percent: value })} error={error("penalty.percent")} suffix="%" />
          ) : null}
        </div>
      </Section>

      <Section title="Water">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput id="waterRate" label="Rate per unit" value={settings.water.ratePerUnit} onChange={(value) => set("water", { ...settings.water, ratePerUnit: value })} error={error("water.ratePerUnit")} suffix="KES" />
          <NumberInput id="waterStanding" label="Standing charge" value={settings.water.standingCharge} onChange={(value) => set("water", { ...settings.water, standingCharge: value })} error={error("water.standingCharge")} suffix="KES / month" />
        </div>
      </Section>

      <Section title="Fixed monthly charges" description="Added to every invoice, e.g. garbage or security.">
        <div className="grid gap-2">
          {settings.fixedCharges.map((charge, index) => (
            <div key={index} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
              <div>
                <Input aria-label="Charge name" value={charge.name} placeholder="Garbage" onChange={(event) => set("fixedCharges", settings.fixedCharges.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))} aria-invalid={Boolean(error(`fixedCharges.${index}.name`)) || undefined} />
                <FieldError id={`fixed-${index}`} message={error(`fixedCharges.${index}.name`) ?? error(`fixedCharges.${index}.amount`)} />
              </div>
              <Input aria-label="Amount (KES)" inputMode="numeric" value={Number.isNaN(charge.amount) ? "" : String(charge.amount)} onChange={(event) => set("fixedCharges", settings.fixedCharges.map((item, position) => (position === index ? { ...item, amount: event.target.value === "" ? Number.NaN : Number(event.target.value.replace(/\D/g, "")) } : item)))} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove charge" onClick={() => set("fixedCharges", settings.fixedCharges.filter((_, position) => position !== index))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set("fixedCharges", [...settings.fixedCharges, { name: "", amount: 0 }])}>
            <Plus /> Add charge
          </Button>
        </div>
      </Section>

      <Section title="Payments">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={settings.prorate} onChange={(event) => set("prorate", event.target.checked)} />
          <span>
            <span className="font-medium">Prorate rent</span>
            <span className="block text-muted-foreground">Charge only the days occupied when a tenant moves in or out mid-month.</span>
          </span>
        </label>
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">Payment order within an invoice</p>
          <ol className="grid gap-1">
            {settings.allocationOrder.map((type, index) => (
              <li key={type} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span>
                  {index + 1}. {ORDER_LABELS[type]}
                </span>
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Move ${ORDER_LABELS[type]} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Move ${ORDER_LABELS[type]} down`} disabled={index === settings.allocationOrder.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">Older invoices are always paid first.</p>
        </div>
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="overpayment">Overpayments</Label>
          <select id="overpayment" className={selectClassName} value={settings.overpayment} onChange={(event) => set("overpayment", event.target.value as "credit" | "refund")}>
            <option value="credit">Keep as credit for next bills</option>
            <option value="refund">Refund to the tenant</option>
          </select>
        </div>
      </Section>

      <Section title="Reminders">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberInput id="daysBeforeDue" label="Before due date" value={settings.reminders.daysBeforeDue} onChange={(value) => set("reminders", { ...settings.reminders, daysBeforeDue: value })} error={error("reminders.daysBeforeDue")} suffix="days" />
          <NumberInput id="daysAfterGrace" label="After grace ends" value={settings.reminders.daysAfterGrace} onChange={(value) => set("reminders", { ...settings.reminders, daysAfterGrace: value })} error={error("reminders.daysAfterGrace")} suffix="days" />
          <NumberInput id="repeatEveryDays" label="Then repeat every" value={settings.reminders.repeatEveryDays} onChange={(value) => set("reminders", { ...settings.reminders, repeatEveryDays: value })} error={error("reminders.repeatEveryDays")} suffix="days" />
        </div>
      </Section>

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" type="date" name="effectiveFrom" defaultValue={today} min={today} aria-invalid={Boolean(errors.effectiveFrom) || undefined} />
          <FieldError id="effectiveFrom-error" message={errors.effectiveFrom} />
          <p className="text-xs text-muted-foreground">Past invoices never change.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={previewing} onClick={() => formRef.current && submitPreview(new FormData(formRef.current))}>
            {previewing ? <Loader2 className="animate-spin" /> : null} Preview
          </Button>
          <Button type="button" disabled={saving} onClick={() => setConfirming(true)}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </div>
      </div>

      {previewState.status === "success" && previewState.data ? (
        <div className="rounded-lg border bg-brand-surface/60 p-4 text-sm">
          <p className="mb-2 font-medium">Impact on this month ({scopeLabel})</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {Object.entries(previewState.data).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this policy for {scopeLabel}?</AlertDialogTitle>
            <AlertDialogDescription>It applies from the effective date. Invoices already issued are not changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                if (formRef.current) submitSave(new FormData(formRef.current));
              }}
            >
              Save policy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
