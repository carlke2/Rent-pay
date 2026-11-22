import { Skeleton } from "@/components/shared/ui/skeleton";

/** Overview skeleton: heading, four stat cards, chart and attention list, then table rows. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the overview">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-48 bg-surface-raised" />
          <Skeleton className="h-4 w-64 bg-surface-raised" />
        </div>
        <Skeleton className="h-10 w-40 rounded-lg bg-surface-raised" />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="grid gap-3 rounded-[14px] border bg-card p-5">
            <Skeleton className="h-4 w-20 bg-surface-raised" />
            <Skeleton className="h-8 w-36 bg-surface-raised" />
            <Skeleton className="h-3 w-48 bg-surface-raised" />
          </div>
        ))}
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="rounded-[14px] border bg-card p-5">
          <Skeleton className="mb-4 h-5 w-32 bg-surface-raised" />
          <Skeleton className="h-[260px] w-full bg-surface-raised sm:h-[300px]" />
        </div>
        <div className="grid content-start gap-4 rounded-[14px] border bg-card p-5">
          <Skeleton className="h-5 w-40 bg-surface-raised" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-[10px] bg-surface-raised" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-4 w-3/4 bg-surface-raised" />
                <Skeleton className="h-3 w-1/2 bg-surface-raised" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[14px] border bg-card p-5">
        <Skeleton className="mb-4 h-5 w-40 bg-surface-raised" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="mb-2 h-11 w-full bg-surface-raised" />
        ))}
      </div>
    </div>
  );
}
