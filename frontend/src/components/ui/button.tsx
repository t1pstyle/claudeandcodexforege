import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Button — единая кнопка всего интерфейса.
 * Варианты:
 *   primary — терракот, для главного CTA ("Начать вариант", "Купить").
 *   secondary — мягкий фон, для вторичных действий ("Отмена", "Назад").
 *   outline — граница без заливки, для нейтральных действий.
 *   ghost — без фона, только hover, для иконочных кнопок в тулбарах.
 *   link — как ссылка, без паддингов.
 *   danger — для деструктивных действий ("Удалить запись").
 * Размеры:
 *   sm (32px), md (40px — default), lg (48px — для hero CTA).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-medium transition-colors",
    "rounded-[var(--radius-md)]",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
        secondary:
          "bg-[var(--color-surface-muted)] text-[var(--color-fg)] hover:bg-[var(--color-border)]",
        outline:
          "border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]",
        ghost:
          "text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]",
        link:
          "text-[var(--color-accent)] underline-offset-4 hover:underline p-0 h-auto",
        danger:
          "bg-[var(--color-danger)] text-white hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
