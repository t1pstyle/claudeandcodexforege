import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Container — единая максимальная ширина контента (1200px) + горизонтальные паддинги.
 * Используем во всех страницах и в хедере/футере, чтобы край текста совпадал.
 */
export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1200px] px-6 sm:px-8", className)}
      {...props}
    />
  );
}
