import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Input — базовый однострочный ввод. Высота совпадает с Button md (40px).
 * Ring на фокусе рисуем через box-shadow, чтобы сохранить стабильную геометрию.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm",
          "placeholder:text-[var(--color-fg-subtle)]",
          "transition-[box-shadow,border-color]",
          "focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-soft)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
