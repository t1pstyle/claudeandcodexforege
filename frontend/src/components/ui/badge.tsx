import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Badge — маленький пилюля-маркер статуса (pending_ai, evaluated, failed)
 * или типа задания (Чтение, Вопросы, Интервью, Монолог).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral:
          "bg-[var(--color-surface-muted)] text-[var(--color-fg-muted)] border border-[var(--color-border)]",
        accent:
          "bg-[var(--color-accent-soft)] text-[var(--color-accent-hover)] border border-[var(--color-accent-soft)]",
        success:
          "bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[var(--color-success-soft)]",
        warning:
          "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[var(--color-warning-soft)]",
        danger:
          "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[var(--color-danger-soft)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
