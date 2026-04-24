import Link from "next/link";
import { Container } from "@/components/ui/container";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
      <Container className="flex flex-col gap-6 py-10 text-sm text-[var(--color-fg-muted)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-[var(--font-serif)] text-lg text-[var(--color-fg)]">
            ЕГЭ-Speaking
          </div>
          <div className="mt-1">
            Тренажёр устной части ЕГЭ · AI-разбор по критериям ФИПИ
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-6">
          <Link href="/terms" className="hover:text-[var(--color-fg)]">
            Условия
          </Link>
          <Link href="/privacy" className="hover:text-[var(--color-fg)]">
            Конфиденциальность
          </Link>
          <Link href="/offer" className="hover:text-[var(--color-fg)]">
            Оферта
          </Link>
          <span className="text-[var(--color-fg-subtle)]">© {year}</span>
        </nav>
      </Container>
    </footer>
  );
}
