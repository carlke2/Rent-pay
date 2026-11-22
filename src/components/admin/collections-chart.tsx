"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { cn } from "@/utilities/class-names";
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../shared/ui/chart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const config: ChartConfig = {
  collected: { label: "Collected", color: "var(--chart-collected)" },
  expected: { label: "Expected", color: "var(--chart-expected)", dashed: true },
};

type Point = { period: string; collected: number; expected: number };

const monthLabel = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
const longLabel = (period: string) => `${LONG_MONTHS[Number(period.slice(5, 7)) - 1] ?? ""} ${period.slice(0, 4)}`;
const thousands = (value: number) => (value >= 1000 ? `${Math.round(value / 1000).toLocaleString("en-KE")}k` : String(value));
const shillings = (value: number) => `KES ${value.toLocaleString("en-KE")}`;

/** A round axis maximum a little above the largest value (e.g. 437,000 → 500,000). */
function niceMaximum(value: number) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value * 1.1) ?? 10;
  return step * magnitude;
}

/** Collected (solid white) vs expected (dashed grey) per month, with the selected month shaded. */
export function CollectionsChart({ points, selectedPeriod }: { points: Point[]; selectedPeriod: string }) {
  const [range, setRange] = useState<"twelve" | "year">("twelve");
  const shown = range === "twelve" ? points : points.filter((point) => point.period.slice(0, 4) === selectedPeriod.slice(0, 4));
  const maximum = niceMaximum(Math.max(0, ...shown.flatMap((point) => [point.collected, point.expected])));
  const data = shown.map((point) => ({ ...point, label: monthLabel(point.period), highlight: point.period === selectedPeriod ? maximum : 0 }));
  const summary = shown.map((point) => `${longLabel(point.period)}: collected ${shillings(point.collected)}, expected ${shillings(point.expected)}`).join("; ");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-heading">Collections</h2>
          <ChartLegendContent config={config} className="mt-1" />
        </div>
        <div role="group" aria-label="Chart range" className="inline-flex rounded-lg border border-border-strong p-0.5">
          {(
            [
              ["twelve", "Last 12 months"],
              ["year", "This year"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn("h-11 rounded-md px-3 text-xs font-medium", range === value ? "bg-surface-raised text-heading shadow-[inset_0_0_0_1px_var(--nav-active-ring)]" : "text-text-secondary hover:text-heading")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only">{summary}</p>
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full sm:h-[300px]" aria-hidden>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={8} />
          <YAxis domain={[0, maximum]} tickFormatter={thousands} tickLine={false} axisLine={false} width={44} tickMargin={6} />
          <Bar dataKey="highlight" fill="var(--foreground)" fillOpacity={0.07} radius={6} isAnimationActive={false} activeBar={false} />
          <ChartTooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltipContent
                active={active}
                payload={payload as never}
                label={label as string}
                labelFormatter={(text) => {
                  const point = data.find((item) => item.label === text);
                  return point ? longLabel(point.period) : text;
                }}
                valueFormatter={shillings}
              />
            )}
          />
          <Line dataKey="expected" type="monotone" stroke="var(--color-expected)" strokeWidth={2.5} strokeDasharray="6 6" dot={false} animationDuration={500} activeDot={{ r: 4, strokeWidth: 0, fill: "var(--color-expected)" }} />
          <Line dataKey="collected" type="monotone" stroke="var(--color-collected)" strokeWidth={3} dot={false} animationDuration={500} activeDot={{ r: 5, strokeWidth: 2, stroke: "#000", fill: "var(--color-collected)" }} />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
