"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/store";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * Правый угол хедера. Три состояния:
 * 1. status=loading (ещё не выяснили) — пустышка фикс. ширины, чтобы шапка не прыгала.
 * 2. status=guest — «Войти» + «Начать бесплатно».
 * 3. status=authed — баланс проверок + «Кабинет» + «Выйти».
 */
export function HeaderAuthActions() {
  // Важно: у Zustand каждый селектор должен возвращать примитив или
  // ссылочно-стабильное значение. Возврат нового объекта `{...}` заставляет
  // React считать, что snapshot меняется, и уходить в бесконечный рендер.
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  const logout = useAuth((s) => s.logout);
  const router = useRouter();

  if (status === "idle" || status === "loading") {
    return <div className="h-9 w-[168px]" aria-hidden />;
  }

  if (status === "authed" && user) {
    return (
      <div className="flex items-center gap-3">
        <Badge variant="accent" title="Доступных AI-проверок">
          {user.paid_checks_available} проверок
        </Badge>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Кабинет
        </Link>
        <button
          onClick={() => {
            logout();
            router.push("/");
          }}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}
        >
          Выйти
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "hidden sm:inline-flex"
        )}
      >
        Войти
      </Link>
      <Link href="/register" className={buttonVariants({ variant: "primary", size: "sm" })}>
        Начать бесплатно
      </Link>
    </div>
  );
}
