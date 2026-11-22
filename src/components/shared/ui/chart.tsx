"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/utilities/class-names";

/** Series name → label and colour (any CSS colour, usually a token). Exposed to children as --color-{key}. */
export type ChartConfig = Record<string, { label: string; color: string; dashed?: boolean }>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used inside <ChartContainer>");
  return context;
}

function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"] }) {
  const style = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color])) as React.CSSProperties;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        style={style}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-surface]:outline-hidden [&_.recharts-wrapper]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

type TooltipEntry = { dataKey?: string | number; value?: number | string; color?: string };

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (value) => String(value),
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  labelFormatter?: (label: string) => React.ReactNode;
  valueFormatter?: (value: number) => string;
}) {
  const { config } = useChart();
  const entries = (payload ?? []).filter((entry) => typeof entry.dataKey === "string" && entry.dataKey in config);
  if (!active || entries.length === 0) return null;
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-surface-raised px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {entries.map((entry) => {
        const item = config[entry.dataKey as string];
        return (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className={cn("h-0.5 w-3 shrink-0", item?.dashed ? "border-t-2 border-dashed" : "rounded-full")} style={item?.dashed ? { borderColor: item.color } : { background: item?.color, height: 3 }} />
            <span className="text-muted-foreground">{item?.label}</span>
            <span className="numbers ml-auto font-medium text-foreground">{valueFormatter(Number(entry.value ?? 0))}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Legend from a chart config: solid or dashed line swatch plus label. Can sit outside the chart (e.g. in a card header). */
function ChartLegendContent({ config, className }: { config: ChartConfig; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-4 text-xs text-muted-foreground", className)}>
      {Object.entries(config).map(([key, item]) => (
        <li key={key} className="flex items-center gap-2">
          <span aria-hidden className={cn("w-4", item.dashed ? "border-t-2 border-dashed" : "h-[3px] rounded-full")} style={item.dashed ? { borderColor: item.color } : { background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent };
