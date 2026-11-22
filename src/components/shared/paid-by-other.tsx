import { describeOtherPayer } from "@/core/payments/payer";
import { cn } from "@/utilities/class-names";

/** Small neutral tag for payments made by someone other than the tenant. Information only. */
export function PaidByOtherTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-text-secondary", className)}>
      Paid by someone else
    </span>
  );
}

/** "Paid by {name} {phone}" under a payment, shown only when someone else paid. */
export function PaidByOtherNote(props: { paidByOther: boolean; payerName: string | null; payerPhone: string | null; className?: string }) {
  if (!props.paidByOther) return null;
  return <span className={cn("block text-xs text-muted-foreground", props.className)}>{describeOtherPayer(props.payerName, props.payerPhone)}</span>;
}
