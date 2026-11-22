import { cn } from "@/utilities/class-names";

type Tone = "paid" | "partial" | "unpaid" | "overdue" | "vacant" | "notice" | "info";

/** Statuses map onto the six status colours (plus brand "info"); the text label is always shown. */
const TONES: Record<string, Tone> = {
  paid: "paid",
  matched: "paid",
  confirmed: "paid",
  sent: "paid",
  delivered: "paid",
  active: "paid",
  partial: "partial",
  unmatched: "partial",
  waiting: "partial",
  pending: "partial",
  queued: "partial",
  flagged: "partial",
  unpaid: "unpaid",
  ended: "unpaid",
  cancelled: "unpaid",
  timed_out: "unpaid",
  overdue: "overdue",
  reversed: "overdue",
  rejected: "overdue",
  failed: "overdue",
  void: "overdue",
  vacant: "vacant",
  reserved: "vacant",
  under_repair: "vacant",
  none: "vacant",
  notice: "notice",
};

const TONE_CLASSES: Record<Tone, string> = {
  paid: "bg-status-paid-surface text-status-paid border-status-paid-border",
  partial: "bg-status-partial-surface text-status-partial border-status-partial-border",
  unpaid: "bg-status-unpaid-surface text-status-unpaid border-status-unpaid-border",
  overdue: "bg-status-overdue-surface text-status-overdue border-status-overdue-border",
  vacant: "bg-status-vacant-surface text-status-vacant border-dashed border-status-vacant-border",
  notice: "bg-status-notice-surface text-status-notice border-status-notice-border",
  info: "bg-status-info-surface text-status-info border-status-info-border",
};

export function statusLabel(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = TONES[status] ?? "info";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label ?? statusLabel(status)}
    </span>
  );
}

/** Tile/cell surface for a status (same colours as the badge). */
export function statusSurfaceClass(status: string): string {
  return TONE_CLASSES[TONES[status] ?? "info"];
}
