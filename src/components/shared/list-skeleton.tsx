import { Skeleton } from "./ui/skeleton";

/** Loading placeholder for list pages: title, a filter row and rows (cards on phones). */
export function ListSkeleton({ rows = 6, cards = false }: { rows?: number; cards?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      {cards ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <Skeleton className="mb-4 h-10 w-full max-w-xl" />
      )}
      <div className="grid gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Rows only: shown in place of a list while another page of it (or new filters) loads, under the kept header. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

/** Loading placeholder for a detail page: back link, title, actions and two panels. */
export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-2 h-7 w-56 max-w-full" />
      <Skeleton className="mb-6 h-4 w-40" />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-32 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

/** Loading placeholder for a form page (settings, move-in, pay). */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      <div className="grid gap-4 rounded-xl border p-5">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="grid gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-12 w-full rounded-[10px]" />
          </div>
        ))}
        <Skeleton className="h-[52px] w-full rounded-[10px]" />
      </div>
    </div>
  );
}

/** Loading placeholder for the public receipt and bill cards (always light, outside the apps). */
export function PublicCardSkeleton() {
  return (
    <main className="flex min-h-dvh justify-center bg-[#F5F5F4] px-4 py-8" aria-busy="true" aria-label="Loading">
      <div className="w-full max-w-[400px] overflow-hidden rounded-[18px] border border-[#E7E5E4] bg-white">
        <div className="h-44 animate-pulse bg-[#E7E5E4]" />
        <div className="grid gap-3 p-5">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-5 animate-pulse rounded bg-[#F0EEEC]" />
          ))}
          <div className="mt-2 h-[46px] animate-pulse rounded-xl bg-[#E7E5E4]" />
        </div>
      </div>
    </main>
  );
}
