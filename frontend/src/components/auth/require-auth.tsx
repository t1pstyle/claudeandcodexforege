"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/store";

/**
 * Клиентский гвард для защищённых страниц: /dashboard, /results/*.
 * Логика:
 * - пока status в idle/loading — показываем fallback (скелет).
 * - если guest — редиректим на /login?next=<текущий путь>.
 * - если authed — рендерим children.
 *
 * Middleware не ставим потому, что токен у нас в localStorage (не в cookie),
 * и SSR не видит, залогинен пользователь или нет. Делать двойной слой
 * «cookie + header» — лишняя сложность на старте.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "guest") {
      const next = encodeURIComponent(pathname ?? "/dashboard");
      router.replace(`/login?next=${next}`);
    }
  }, [status, router, pathname]);

  if (status === "authed") return <>{children}</>;

  return (
    <div className="py-16 text-center text-sm text-[var(--color-fg-muted)]">
      Проверяем вход…
    </div>
  );
}
