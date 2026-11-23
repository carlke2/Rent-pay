"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { checkPaymentAction, startPaymentAction, type PaymentProgress } from "@/app/tenants/actions/payments";
import SlideToConfirm from "@/components/kokonutui/slide-to-confirm";
import { FieldError } from "@/components/shared/action-form";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import { useServerForm } from "@/components/shared/use-server-form";
import { formatShillings } from "@/utilities/money";
import { PaybillCard } from "./paybill-card";

const POLL_MILLISECONDS = 3_000;
const PROMPT_SECONDS = 60;
const GIVE_UP_MILLISECONDS = 3 * 60_000;

type Props = { defaultAmount: number; defaultPhone: string; paybill: string; account: string };

/** Amount and phone → M-Pesa prompt → waiting (polls every 3 s) → paid or failed. */
export function PayFlow(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <PayAttempt key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />;
}

function PayAttempt({ defaultAmount, defaultPhone, paybill, account, onRetry }: Props & { onRetry: () => void }) {
  const { state, submit } = useServerForm(startPaymentAction);
  const [amount, setAmount] = useState(String(defaultAmount));
  const formRef = useRef<HTMLFormElement>(null);
  // Settled when the server answers, so the slider spins until then and slides back on an error.
  const settle = useRef<{ resolve: () => void; reject: () => void } | null>(null);
  const seen = useRef(0);
  useEffect(() => {
    if (state.at && state.at !== seen.current) {
      seen.current = state.at;
      if (state.status === "error") settle.current?.reject();
      else settle.current?.resolve();
      settle.current = null;
      if (state.status === "error" && state.message && !state.fieldErrors) toast.error(state.message);
    }
  }, [state]);

  const confirm = () =>
    new Promise<void>((resolve, reject) => {
      if (!formRef.current) return reject();
      settle.current = { resolve, reject };
      submit(new FormData(formRef.current));
    });

  const requestId = state.status === "success" ? (state.data?.requestId as string | undefined) : undefined;
  if (requestId) return <Progress requestId={requestId} amount={Number(state.data?.amount)} paybill={paybill} account={account} onRetry={onRetry} />;

  const valid = /^\d+$/.test(amount) && Number(amount) > 0;
  const shown = valid ? formatShillings(Number(amount)) : "KES —";
  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="grid gap-5" noValidate>
      {state.status === "error" && state.message && !state.fieldErrors ? (
        <p role="alert" className="rounded-[10px] border border-destructive/30 bg-status-overdue-surface px-3.5 py-3 text-sm text-destructive">{state.message}</p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="pay-amount" className="text-text-secondary">Amount (KES)</Label>
        <Input id="pay-amount" name="amount" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))} aria-invalid={Boolean(state.fieldErrors?.amount) || undefined} className="text-xl font-semibold" />
        <FieldError id="pay-amount-error" message={state.fieldErrors?.amount} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pay-phone" className="text-text-secondary">M-Pesa phone number</Label>
        <Input id="pay-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" defaultValue={defaultPhone} aria-invalid={Boolean(state.fieldErrors?.phone) || undefined} />
        <FieldError id="pay-phone-error" message={state.fieldErrors?.phone} />
        <p className="text-sm text-muted-foreground">You&apos;ll get an M-Pesa prompt on this phone.</p>
      </div>
      <SlideToConfirm
        label={`Slide to pay ${shown}`}
        confirmingLabel="Sending M-Pesa prompt"
        doneLabel="Check your phone"
        onConfirm={confirm}
        resetAfter={null}
        disabled={!valid}
        className="max-w-none"
      />
    </form>
  );
}

function Progress({ requestId, amount, paybill, account, onRetry }: { requestId: string; amount: number; paybill: string; account: string; onRetry: () => void }) {
  const [progress, setProgress] = useState<PaymentProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(Date.now());
  const status = progress?.status ?? "pending";

  useEffect(() => {
    if (status !== "pending") return;
    const clock = setInterval(() => setElapsed(Date.now() - started.current), 500);
    let active = true;
    const poll = setInterval(async () => {
      if (Date.now() - started.current > GIVE_UP_MILLISECONDS) return;
      try {
        const next = await checkPaymentAction(requestId);
        if (active && next) setProgress(next);
      } catch {
        // A network blip: try again on the next tick.
      }
    }, POLL_MILLISECONDS);
    return () => {
      active = false;
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [requestId, status]);

  if (status === "paid" && progress) {
    return (
      <div className="grid gap-5 text-center" role="status">
        <CircleCheck className="mx-auto size-16 text-status-paid" aria-hidden />
        <div>
          <h2 className="text-2xl font-semibold text-heading">Payment received</h2>
          <p className="mt-1 text-3xl font-semibold text-heading">{formatShillings(progress.amount)}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-surface-muted p-4 text-left text-sm">
          <dt className="text-muted-foreground">M-Pesa receipt</dt>
          <dd className="text-right font-medium">{progress.mpesaReceipt ?? "–"}</dd>
          <dt className="text-muted-foreground">New balance</dt>
          <dd className="text-right font-medium">{progress.balance === null ? "–" : progress.balance < 0 ? `Credit ${formatShillings(-progress.balance)}` : formatShillings(progress.balance)}</dd>
        </dl>
        {progress.receiptToken ? (
          <Button asChild size="lg" className="w-full">
            <Link prefetch={false} href={`/receipts/${progress.receiptToken}`} className="no-underline">View receipt</Link>
          </Button>
        ) : null}
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link prefetch={false} href="/tenants" className="no-underline">Back home</Link>
        </Button>
      </div>
    );
  }

  if (status !== "pending" && progress) {
    return (
      <div className="grid gap-5" role="alert">
        <div className="text-center">
          <CircleX className="mx-auto size-16 text-status-overdue" aria-hidden />
          <h2 className="mt-3 text-2xl font-semibold text-heading">{status === "cancelled" ? "Payment cancelled" : status === "timed_out" ? "Payment timed out" : "Payment didn't go through"}</h2>
          <p className="mt-1 text-text-secondary">{progress.reason}</p>
        </div>
        <Button size="lg" className="w-full" onClick={onRetry}>
          Try again
        </Button>
        <PaybillCard paybill={paybill} account={account} title="Or pay from the M-Pesa menu" />
      </div>
    );
  }

  const gaveUp = elapsed > GIVE_UP_MILLISECONDS;
  const promptLeft = Math.max(0, PROMPT_SECONDS - Math.floor(elapsed / 1000));
  return (
    <div className="grid gap-5 text-center" role="status" aria-live="polite">
      <div className="mx-auto grid size-20 place-items-center rounded-full bg-surface-muted">
        <Smartphone className="size-9 text-heading" aria-hidden />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-heading">{gaveUp ? "Still waiting for M-Pesa" : "Check your phone and enter your M-Pesa PIN"}</h2>
        <p className="mt-1 text-text-secondary">
          {gaveUp ? "If you entered your PIN, we'll text your receipt as soon as M-Pesa confirms." : `Paying ${formatShillings(amount)}. The prompt stays open for about a minute.`}
        </p>
      </div>
      {!gaveUp ? (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={PROMPT_SECONDS} aria-valuenow={PROMPT_SECONDS - promptLeft} aria-label="Time left to enter your PIN">
            <div className="h-full rounded-full bg-heading transition-[width] duration-500" style={{ width: `${Math.min(100, (elapsed / (PROMPT_SECONDS * 1000)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{promptLeft > 0 ? `${promptLeft} seconds left` : "Checking with M-Pesa…"}</p>
        </div>
      ) : (
        <Button size="lg" variant="outline" className="w-full" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
