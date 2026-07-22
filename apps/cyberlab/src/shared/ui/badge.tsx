import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-mono font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-line text-ink-mid",
        outline:
          "rounded-full border-line px-2.5 tracking-[0.04em] text-ink-mid normal-case",
        capture:
          "border-[color-mix(in_srgb,var(--attacker)_45%,transparent)] bg-[color-mix(in_srgb,var(--attacker)_12%,transparent)] text-attacker",
        sim: "border-[color-mix(in_srgb,var(--hardener)_45%,var(--line))] bg-[color-mix(in_srgb,var(--hardener)_10%,transparent)] text-hardener",
        live: "border-[color-mix(in_srgb,var(--responder)_45%,var(--line))] bg-[color-mix(in_srgb,var(--responder)_10%,transparent)] text-responder",
      },
      size: {
        default: "px-2 py-1 text-[10px] leading-none",
        sm: "px-1.5 py-[3px] text-[9.5px] leading-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
