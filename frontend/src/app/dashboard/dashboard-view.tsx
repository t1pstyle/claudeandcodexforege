"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RequireAuth } from "@/components/auth/require-auth";
import { useAuth } from "@/lib/auth/store";
import { listSubmissions, type SubmissionRead } from "@/lib/api/endpoints";
import { TASK_TYPE_META, STATUS_META } from "@/lib/task-meta";

/**
 * Главный экран залогиненного пользователя. Три блока:
 *  1. Приветствие + баланс + CTA "Начать новый вариант".
 *  2. Последние записи (максимум 10).
 *  3. Пустое состояние, если записей нет.
 */
export function DashboardView() {
  return (
    <RequireAuth>
      <Container className="py-10">
        <DashboardContent />
      </Container>
    </RequireAuth>
  );
}

function DashboardContent() {
  const user = useAuth((s) => s.user);
  const [subs, setSubs] = useState<SubmissionRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listSubmissions();
        if (!cancelled) setSubs(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить записи");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* ── Greeting + balance ────────────────────────────────────── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-[var(--font-serif)] text-3xl md:text-4xl">
            Здравствуйте{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-2 text-[var(--color-fg-muted)]">
            Готовы тренироваться? Выбирайте вариант и начинайте.
          </p>
        </div>
        <Card className="md:max-w-sm md:shrink-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                  Оплаченных проверок
                </div>
                <div className="font-[var(--font-serif)] text-3xl text-[var(--color-fg)]">
                  {user?.paid_checks_available ?? 0}
                </div>
              </div>
              <Link
                href="/pricing"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Пополнить
              </Link>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* ── CTA: новый вариант ─────────────────────────────────────── */}
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/variants" className={buttonVariants({ variant: "primary" })}>
          Выбрать вариант
        </Link>
      </div>

      {/* ── История записей ────────────────────────────────────────── */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="font-[var(--font-serif)] text-2xl">Мои записи</h2>
          <span className="text-sm text-[var(--color-fg-subtle)]">
            Бесплатные записи хранятся 24 часа
          </span>
        </div>

        <div className="mt-6">
          {error ? (
            <EmptyState title="Не удалось загрузить" description={error} />
          ) : subs === null ? (
            <div className="text-sm text-[var(--color-fg-muted)]">Загружаем…</div>
          ) : subs.length === 0 ? (
            <EmptyState
              title="Пока нет записей"
              description="Выберите вариант и сделайте первую запись — всё получится."
              cta={{ href: "/variants", label: "Открыть каталог" }}
            />
          ) : (
            <div className="grid gap-3">
              {subs.slice(0, 12).map((s) => (
                <SubmissionRow key={s.id} s={s} />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SubmissionRow({ s }: { s: SubmissionRead }) {
  const meta = TASK_TYPE_META[s.task.task_type];
  const status = STATUS_META[s.status];
  const date = new Date(s.created_at);

  return (
    <Card className="flex flex-row items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex items-center gap-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] font-[var(--font-serif)] text-lg text-[var(--color-accent)]">
          {meta.number}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--color-fg)]">
            Задание {meta.number} — {meta.title}
          </div>
          <div className="text-xs text-[var(--color-fg-subtle)]">
            {date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} ·{" "}
            {date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            {s.ai_requested && " · с AI-разбором"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={status.variant}>{status.label}</Badge>
        {s.ai_requested && (
          <Link
            href={`/results/${s.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Разбор →
          </Link>
        )}
      </div>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: { href: string; label: string };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-fg-muted)]">{description}</p>
        {cta && (
          <Link href={cta.href} className={buttonVariants({ variant: "primary", size: "sm" }) + " w-fit"}>
            {cta.label}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
