"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "./ui/skeleton";

/**
 * The trend chart, loaded on demand in the browser only. The chart library (recharts) is the biggest script in the
 * app; loading it this way keeps it out of the first download of both overview pages, which show the rest of the
 * page while it arrives. The placeholder has the chart's size, so nothing moves when it appears.
 */
export const TrendChart = dynamic(() => import("./trend-chart").then((module) => module.TrendChart), {
  ssr: false,
  loading: () => (
    <div aria-busy="true" aria-label="Loading chart">
      <Skeleton className="mb-2 h-5 w-36 bg-surface-raised" />
      <Skeleton className="mb-4 h-3 w-28 bg-surface-raised" />
      <Skeleton className="h-[260px] w-full bg-surface-raised sm:h-[300px]" />
    </div>
  ),
});
