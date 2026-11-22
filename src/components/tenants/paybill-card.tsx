import { CopyButton } from "@/components/shared/copy-button";

/** Paybill and account number with copy buttons, and the M-Pesa menu steps. */
export function PaybillCard({ paybill, account, title = "Pay from the M-Pesa menu" }: { paybill: string; account: string; title?: string }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-semibold text-heading">{title}</h2>
      <dl className="mt-3 grid gap-2">
        {[
          ["Paybill", paybill, "Paybill number"],
          ["Account number", account, "Account number"],
        ].map(([label, value, copyLabel]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-2">
            <div>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tracking-wide text-heading">{value}</dd>
            </div>
            <CopyButton value={value as string} label={copyLabel as string} />
          </div>
        ))}
      </dl>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-text-secondary">
        {["M-Pesa", "Lipa na M-Pesa", "Pay Bill", "Business no.", "Account no.", "Amount", "PIN"].map((step, index, all) => (
          <li key={step} className="flex items-center gap-1.5">
            {step}
            {index < all.length - 1 ? <span aria-hidden className="text-muted-foreground">→</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
