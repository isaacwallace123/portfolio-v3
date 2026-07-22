import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_22%,var(--panel-2))] text-[color-mix(in_srgb,var(--accent)_92%,#fff)] hover:bg-[color-mix(in_srgb,var(--accent)_32%,var(--panel-2))]",
        secondary:
          "border border-line bg-panel-2 text-ink hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]",
        ghost: "text-ink-mid hover:bg-panel-2 hover:text-ink",
        outline:
          "border border-line bg-transparent text-ink hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] hover:bg-panel-2",
        destructive:
          "border border-[color-mix(in_srgb,var(--attacker)_55%,var(--line))] bg-[color-mix(in_srgb,var(--attacker)_20%,var(--panel-2))] text-[color-mix(in_srgb,var(--attacker)_92%,#fff)] hover:bg-[color-mix(in_srgb,var(--attacker)_30%,var(--panel-2))]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-[18px] py-2",
        sm: "h-8 gap-1.5 rounded-md px-3 text-[13px]",
        lg: "h-11 rounded-lg px-6",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
