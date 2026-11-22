import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/utilities/class-names"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary font-semibold text-primary-foreground hover:bg-primary/85",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border-strong bg-card text-text-secondary shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-secondary-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      size: {
        default: "h-[52px] rounded-[10px] px-6 text-[15px] has-[>svg]:px-5",
        xs: "h-8 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3 relative after:absolute after:-inset-1.5 after:content-['']",
        sm: "h-11 gap-1.5 rounded-lg px-3.5 has-[>svg]:px-3",
        lg: "h-[54px] rounded-xl px-8 text-base has-[>svg]:px-6",
        icon: "size-11 rounded-[10px]",
        "icon-xs": "size-7 rounded-md relative after:absolute after:-inset-2 after:content-[''] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 relative after:absolute after:-inset-1 after:content-['']",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
