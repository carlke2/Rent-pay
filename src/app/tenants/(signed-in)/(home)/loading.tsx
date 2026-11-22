import { dashboardCard as card } from "@/components/shared/dashboard";
import { Skeleton } from "@/components/shared/ui/skeleton";
import { cn } from "@/utilities/class-names";

const bone = "bg-surface-raised";

/** Mirrors the tenant overview: header, 4 stats, chart + how to pay, bills table + receipts. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading your overview">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className={cn("h-8 w-44", bone)} />
          <Skeleton className={cn("h-4 w-56", bone)} />
        </div>
        <div className="flex gap-2">
          <Skeleton className={cn("h-9 w-28 rounded-lg", bone)} />
          <Skeleton className={cn("hidden h-9 w-28 rounded-lg sm:block", bone)} />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-3 rounded-[14px] bg-primary/90 p-5">
          <Skeleton className="h-4 w-24 bg-primary-foreground/20" />
          <Skeleton className="h-8 w-36 bg-primary-foreground/20" />
          <Skeleton className="h-3 w-28 bg-primary-foreground/20" />
          <Skeleton className="mt-1 h-11 w-full rounded-lg bg-primary-foreground/25" />
        </div>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={cn(card, "grid content-start gap-3 p-5")}>
            <Skeleton className={cn("h-4 w-24", bone)} />
            <Skeleton className={cn("h-8 w-36", bone)} />
            <Skeleton className={cn("h-3 w-40", bone)} />
          </div>
        ))}
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={cn(card, "p-5")}>
          <Skeleton className={cn("mb-2 h-5 w-36", bone)} />
          <Skeleton className={cn("mb-4 h-3 w-28", bone)} />
          <Skeleton className={cn("h-[260px] w-full sm:h-[300px]", bone)} />
        </div>
        <div className="grid content-start gap-4">
          <div className={cn(card, "grid gap-3 p-5")}>
            <Skeleton className={cn("h-5 w-28", bone)} />
            <Skeleton className={cn("h-14 w-full rounded-xl", bone)} />
            <Skeleton className={cn("h-14 w-full rounded-xl", bone)} />
            <Skeleton className={cn("h-4 w-5/6", bone)} />
          </div>
          <div className={cn(card, "flex items-center gap-3 p-4")}>
            <Skeleton className={cn("size-10 rounded-[10px]", bone)} />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className={cn("h-4 w-2/3", bone)} />
              <Skeleton className={cn("h-3 w-1/2", bone)} />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={cn(card, "p-5")}>
          <Skeleton className={cn("mb-4 h-5 w-32", bone)} />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className={cn("mb-2 h-11 w-full", bone)} />
          ))}
        </div>
        <div className={cn(card, "grid content-start gap-4 p-5")}>
          <Skeleton className={cn("h-5 w-36", bone)} />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className={cn("size-9 shrink-0 rounded-full", bone)} />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className={cn("h-4 w-3/4", bone)} />
                <Skeleton className={cn("h-3 w-1/2", bone)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
