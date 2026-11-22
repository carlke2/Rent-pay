import { cn } from "@/utilities/class-names";

/** House-with-check mark: navy on a white circle, or black on a white rounded tile (`shape="tile"`, the dark landlord app). */
export function LogoMark({ className, shape = "circle" }: { className?: string; shape?: "circle" | "tile" }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center bg-white",
        shape === "circle" ? "rounded-full shadow-[0_0_0_1px_var(--border)]" : "rounded-lg",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" stroke={shape === "circle" ? "#1e2a4a" : "#000000"} strokeWidth={shape === "circle" ? 1.8 : 2.1} strokeLinecap="round" strokeLinejoin="round" className="size-[60%]">
        <path d="M3.5 10.5 12 4l8.5 6.5" />
        <path d="M5.5 9v10.5h13V9" />
        <path d="m9 14.2 2.2 2.2 4-4.4" />
      </svg>
    </span>
  );
}

/** The logo: mark plus the app name. `tone="light"` for dark backgrounds. */
export function Logo({ appName, tone = "dark", size = "default", className }: { appName: string; tone?: "dark" | "light"; size?: "small" | "default"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={size === "small" ? "size-7" : undefined} />
      <span className={cn("font-semibold tracking-tight", size === "small" ? "text-base" : "text-lg", tone === "light" ? "text-white" : "text-heading")}>{appName}</span>
    </span>
  );
}
