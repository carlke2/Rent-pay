const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const shillings = (value: number) => `KES ${value.toLocaleString("en-KE")}`;
const thousands = (value: number) => (value >= 1000 ? `${Math.round(value / 1000).toLocaleString("en-KE")}k` : String(value));
const monthOf = (period: string) => Number(period.slice(5, 7)) - 1;

/**
 * Billed vs paid per month for the tenant's lease. Plain HTML/CSS bars (server-rendered): tenant pages don't
 * load a chart library, which keeps the portal light on phones.
 */
export function TenantPaymentsChart({ points }: { points: { period: string; billed: number; paid: number }[] }) {
  const largest = Math.max(0, ...points.flatMap((point) => [point.billed, point.paid]));
  const height = (value: number) => (largest > 0 ? `${Math.max(value > 0 ? 3 : 0, Math.round((value / largest) * 100))}%` : "0%");
  const summary = points.map((point) => `${LONG_MONTHS[monthOf(point.period)]} ${point.period.slice(0, 4)}: billed ${shillings(point.billed)}, paid ${shillings(point.paid)}`).join("; ");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-heading">Billed and paid</h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[var(--chart-expected)]" /> Billed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[var(--chart-collected)]" /> Paid
          </span>
        </div>
      </div>
      <p className="sr-only">{summary || "No bills yet."}</p>
      {points.length === 0 ? (
        <p className="grid h-[200px] place-items-center text-sm text-muted-foreground">Your first bill will show here.</p>
      ) : (
        <div aria-hidden>
          <div className="relative flex h-[180px] items-end gap-2 border-b border-[var(--chart-grid)]">
            <span className="numbers absolute top-0 left-0 -translate-y-1/2 bg-card pr-1 text-[10px] text-muted-foreground">{thousands(largest)}</span>
            <span className="absolute inset-x-0 top-0 border-t border-dashed border-[var(--chart-grid)]" />
            <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--chart-grid)]" />
            {points.map((point) => (
              <div key={point.period} className="flex h-full min-w-0 flex-1 items-end justify-center gap-1" title={`${MONTHS[monthOf(point.period)]}: billed ${shillings(point.billed)}, paid ${shillings(point.paid)}`}>
                <span className="w-full max-w-[14px] rounded-t-[4px] bg-[var(--chart-expected)]" style={{ height: height(point.billed) }} />
                <span className="w-full max-w-[14px] rounded-t-[4px] bg-[var(--chart-collected)]" style={{ height: height(point.paid) }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {points.map((point) => (
              <span key={point.period} className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">
                {MONTHS[monthOf(point.period)]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
