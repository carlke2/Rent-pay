import { Skeleton } from "@/components/shared/ui/skeleton";
import { cn } from "@/utilities/class-names";

const bone = "bg-surface-raised";

/** Mirrors the profile: 360px card (cover, avatar, name, stats) beside the contact-details card. */
export default function Loading() {
  return (
    <div className="sm:-mx-2 md:mx-auto md:max-w-[420px] lg:mx-0 lg:flex lg:max-w-none lg:items-start lg:gap-6" aria-busy="true" aria-label="Loading your profile">
      <div className="overflow-hidden rounded-[20px] border bg-card lg:w-[360px] lg:shrink-0">
        <div className="h-24 bg-gradient-to-br from-[#0A0A0A] to-[#1C1C1F]" />
        <div className="p-5">
          <div className="-mt-[60px] flex items-end justify-between">
            <Skeleton className={cn("size-20 rounded-full ring-4 ring-card", bone)} />
            <Skeleton className={cn("mb-1 h-9 w-28 rounded-full", bone)} />
          </div>
          <Skeleton className={cn("mt-3 h-7 w-48", bone)} />
          <Skeleton className={cn("mt-2 h-4 w-40", bone)} />
          <Skeleton className={cn("mt-1.5 h-4 w-36", bone)} />
          <Skeleton className={cn("mt-4 h-[54px] w-full", bone)} />
        </div>
      </div>
      <div className="mt-6 grid gap-3 lg:mt-0 lg:max-w-[520px] lg:flex-1">
        <Skeleton className={cn("h-5 w-32", bone)} />
        <Skeleton className={cn("h-[226px] w-full rounded-[14px]", bone)} />
      </div>
    </div>
  );
}
