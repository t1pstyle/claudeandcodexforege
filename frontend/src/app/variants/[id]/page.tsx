import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getVariant } from "@/lib/api/endpoints";

import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TASK_TYPE_META } from "@/lib/task-meta";

export const revalidate = 300;

/**
 * Обзор варианта — это не «каталог заданий», а предпросмотр целостного теста.
 * Тест проходится только целиком: один CTA «Начать вариант» → /variants/[id]/exam.
 * Отдельных входов в задание нет, как и на реальном экзамене.
 */
export default async function VariantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let variant: Awaited<ReturnType<typeof getVariant>>;
  try {
    variant = await getVariant(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const tasks = [...variant.tasks].sort((a, b) => a.task_number - b.task_number);
  const totalPrep = tasks.reduce((acc, t) => acc + t.prep_seconds, 0);
  const totalSpeak = tasks.reduce((acc, t) => acc + t.speak_seconds, 0);
  const totalMax = tasks.reduce(
    (acc, t) => acc + TASK_TYPE_META[t.task_type].maxScore,
    0
  );

  return (
    <Container className="py-10">
      <Link
        href="/variants"
        className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      >
        ← Все варианты
      </Link>

      <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
        {/* ── Левая колонка: описание + план теста ─────────────── */}
        <div>
          <h1 className="font-[var(--font-serif)] text-3xl md:text-4xl">
            {variant.title}
          </h1>
          {variant.description && (
            <p className="mt-3 max-w-2xl text-[var(--color-fg-muted)]">
              {variant.description}
            </p>
          )}

          <div className="mt-10">
            <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
              Структура теста
            </div>
            <ol className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {tasks.map((t) => {
                const meta = TASK_TYPE_META[t.task_type];
                return (
                  <li key={t.id} className="flex items-center gap-5 py-4">
                    <div className="flex h-10 w-10 flex-none items-center justify-center border border-[var(--color-border-strong)] font-[var(--font-serif)] text-lg text-[var(--color-fg)]">
                      {meta.number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[var(--color-fg)]">
                        {meta.title}
                      </div>
                      <div className="text-sm text-[var(--color-fg-muted)]">
                        Подготовка {formatTime(t.prep_seconds)} · ответ{" "}
                        {formatTime(t.speak_seconds)}
                      </div>
                    </div>
                    <Badge>до {meta.maxScore} балл{wordFormScore(meta.maxScore)}</Badge>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* ── Правая колонка: sticky-CTA ───────────────────────── */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
              Всего
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <Row term="Заданий" value={`${tasks.length}`} />
              <Row term="Время" value={formatTime(totalPrep + totalSpeak)} />
              <Row term="Максимум" value={`${totalMax} баллов`} />
            </dl>

            <Link
              href={`/variants/${id}/exam`}
              className={buttonVariants({ variant: "primary", size: "lg" }) + " mt-6 w-full"}
            >
              Начать вариант
            </Link>

            <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
              Проходится целиком, без пауз между заданиями — как на реальном экзамене.
              Прерваться можно в любой момент.
            </p>
          </div>
        </aside>
      </div>
    </Container>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-fg-muted)]">{term}</dt>
      <dd className="font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s} сек`;
  if (s === 0) return `${m} мин`;
  return `${m} мин ${s} сек`;
}

function wordFormScore(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "ов";
  if (mod10 === 1) return "";
  if (mod10 >= 2 && mod10 <= 4) return "а";
  return "ов";
}
