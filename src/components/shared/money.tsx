import { cn } from "@/utilities/class-names";
import { formatShillings } from "@/utilities/money";

/**
 * "KES 15,640" with tabular figures. With `balance`, a negative amount reads "Credit KES 500" in green.
 */
export function Money({ amount, balance = false, className }: { amount: number; balance?: boolean; className?: string }) {
  if (balance && amount < 0) {
    return <span className={cn("numbers whitespace-nowrap text-credit", className)}>Credit {formatShillings(-amount)}</span>;
  }
  return <span className={cn("numbers whitespace-nowrap", className)}>{formatShillings(amount)}</span>;
}
