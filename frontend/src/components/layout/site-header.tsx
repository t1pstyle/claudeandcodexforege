import Link from "next/link";
import { Container } from "@/components/ui/container";
import { HeaderAuthActions } from "./header-auth-actions";

/**
 * Шапка сайта (RSC). Логотип и навигация — серверные,
 * правый угол (CTA / меню пользователя) — клиентский HeaderAuthActions.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--color-fg)]"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white font-[var(--font-serif)] text-[15px]"
          >
            Я
          </span>
          ЕГЭ-Speaking
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm text-[var(--color-fg-muted)]">
          <Link href="/#how" className="hover:text-[var(--color-fg)] transition-colors">
            Как это работает
          </Link>
          <Link href="/#pricing" className="hover:text-[var(--color-fg)] transition-colors">
            Стоимость
          </Link>
          <Link href="/variants" className="hover:text-[var(--color-fg)] transition-colors">
            Варианты
          </Link>
        </nav>

        <HeaderAuthActions />
      </Container>
    </header>
  );
}
