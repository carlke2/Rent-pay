import { AlertTriangle, ClipboardCheck, Droplets, Wallet, type LucideIcon } from "lucide-react";
import type { AttentionItem } from "@/services/reports";

/** Icon and tinted tile colours for each kind of attention item (dashboard list and notifications popover). */
export const ATTENTION_ICONS: Record<AttentionItem["kind"], { icon: LucideIcon; tile: string }> = {
  unmatched: { icon: Wallet, tile: "bg-status-partial-surface text-status-partial ring-status-partial-border/40" },
  claim: { icon: ClipboardCheck, tile: "bg-status-info-surface text-status-info ring-status-info-border/60" },
  reading: { icon: Droplets, tile: "bg-status-unpaid-surface text-status-unpaid ring-status-unpaid-border/60" },
  overdue: { icon: AlertTriangle, tile: "bg-status-overdue-surface text-status-overdue ring-status-overdue-border/40" },
};
