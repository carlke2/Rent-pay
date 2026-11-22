import Image from "next/image";
import { cn } from "@/utilities/class-names";

/** Artwork sizes from the SVG viewBoxes in public/brand. */
const RATIO = { full: 304.85 / 74.5, mark: 52 / 48 } as const;

export type LogoProps = {
  /** "dark": cream artwork for dark backgrounds. "light": black artwork for light backgrounds. */
  variant: "dark" | "light";
  /** "full": mark and wordmark. "mark": the house mark only. */
  kind?: "full" | "mark";
  /** Rendered height in px; the width follows the artwork's ratio. */
  height: number;
  /** Set where the logo is above the fold. */
  priority?: boolean;
  className?: string;
};

/** The RentPay logo, from /brand/{logo|mark}-{dark|light}.svg. */
export function Logo({ variant, kind = "full", height, priority = false, className }: LogoProps) {
  const width = Math.round(height * RATIO[kind] * 100) / 100;
  return (
    <Image
      src={`/brand/${kind === "full" ? "logo" : "mark"}-${variant}.svg`}
      alt="RentPay"
      width={Math.round(width)}
      height={height}
      priority={priority}
      unoptimized
      className={cn("block shrink-0", className)}
      style={{ width, height }}
    />
  );
}

/**
 * For surfaces that follow the landlord app / tenant portal theme toggle: the dark variant on the dark theme
 * (the default), the light variant on the light theme. Only use inside .theme-admin or .theme-tenant.
 */
export function ThemedLogo({ className, ...props }: Omit<LogoProps, "variant">) {
  return (
    <>
      <Logo {...props} variant="light" className={cn("dark:hidden", className)} />
      <Logo {...props} variant="dark" className={cn("hidden dark:block", className)} />
    </>
  );
}
