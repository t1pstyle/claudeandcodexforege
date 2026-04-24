import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Утилита для условного объединения классов Tailwind.
 * clsx разрешает условные значения, twMerge схлопывает конфликты (p-2 p-4 → p-4).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
