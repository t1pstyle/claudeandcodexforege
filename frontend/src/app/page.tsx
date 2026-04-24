import Link from "next/link";
import { Container } from "@/components/ui/container";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Главная страница (публичная, SSR).
 * Структура:
 *   1. Hero — крупный заголовок + CTA.
 *   2. «Как это работает» — 3 шага.
 *   3. 4 задания ЕГЭ — карточки, коротко о каждом.
 *   4. Стоимость — 2 тарифа.
 *   5. Финальный CTA.
 */

const TASKS = [
  {
    n: 1,
    title: "Чтение вслух",
    desc: "Текст ~160 слов. 1,5 минуты подготовки + 1,5 минуты чтения.",
    score: "1 балл",
  },
  {
    n: 2,
    title: "Четыре вопроса",
    desc: "Нужно задать 4 прямых вопроса на основе объявления и ключевых слов.",
    score: "4 балла",
  },
  {
    n: 3,
    title: "Интервью",
    desc: "5 вопросов электронного ассистента — дать чёткий ответ 6-9 секунд на каждый.",
    score: "5 баллов",
  },
  {
    n: 4,
    title: "Монолог по фото",
    desc: "Сравнить два фото и обосновать выбор. 2,5 мин подготовки + 3 мин речи.",
    score: "10 баллов",
  },
] as const;

export default function HomePage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(ellipse_at_center_top,var(--color-accent-soft)_0%,transparent_60%)]"
        />
        <Container className="pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="max-w-3xl">
            <Badge variant="accent" className="mb-6">
              Критерии ФИПИ · 2026
            </Badge>
            <h1 className="font-[var(--font-serif)] text-4xl leading-[1.1] text-[var(--color-fg)] sm:text-5xl md:text-6xl">
              Сдавайте устную часть ЕГЭ уверенно —{" "}
              <span className="text-[var(--color-accent)]">с разбором от AI</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-fg-muted)]">
              Записывайте ответы на все 4 задания, получайте оценку по каждому
              критерию и конкретные советы — всё по официальным демоверсиям ФИПИ.
              Первая попытка любого варианта — бесплатно.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link href="/register" className={buttonVariants({ variant: "primary", size: "lg" })}>
                Попробовать бесплатно
              </Link>
              <Link
                href="/#pricing"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "font-normal")}
              >
                Как оценивает AI →
              </Link>
            </div>

            <p className="mt-6 text-sm text-[var(--color-fg-subtle)]">
              Проверка и оценка осуществляются передовыми моделями AI.
            </p>
          </div>
        </Container>
      </section>

      {/* ── Как это работает ───────────────────────────────────────── */}
      <section id="how" className="py-20">
        <Container>
          <h2 className="font-[var(--font-serif)] text-3xl md:text-4xl">Как это работает</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "1",
                t: "Выбираете вариант",
                d: "Каталог демоверсий и тренировочных комплектов. Все задания — с оригинальными текстами, изображениями и временем.",
              },
              {
                n: "2",
                t: "Записываете ответ",
                d: "Встроенный диктофон: таймер подготовки, таймер ответа, индикатор уровня сигнала. Можно переписать.",
              },
              {
                n: "3",
                t: "Получаете разбор",
                d: "AI выделит ошибки произношения, проблемы с грамматикой и даст конкретные советы — на русском.",
              },
            ].map((s) => (
              <Card key={s.n}>
                <CardHeader>
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] font-[var(--font-serif)] text-lg text-[var(--color-accent)]">
                    {s.n}
                  </div>
                  <CardTitle>{s.t}</CardTitle>
                  <CardDescription>{s.d}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* ── 4 задания ──────────────────────────────────────────────── */}
      <section className="py-20 bg-[var(--color-surface-muted)]/60">
        <Container>
          <h2 className="font-[var(--font-serif)] text-3xl md:text-4xl">
            Четыре задания устной части
          </h2>
          <p className="mt-3 max-w-2xl text-[var(--color-fg-muted)]">
            Формат и время — как на реальном экзамене. Максимум — 20 баллов.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {TASKS.map((t) => (
              <Card key={t.n}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-[var(--font-serif)] text-2xl text-[var(--color-accent)]">
                        {t.n}
                      </span>
                      <CardTitle>{t.title}</CardTitle>
                    </div>
                    <Badge>{t.score}</Badge>
                  </div>
                  <CardDescription className="pt-1">{t.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Стоимость ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-20">
        <Container>
          <div className="max-w-2xl">
            <h2 className="font-[var(--font-serif)] text-3xl md:text-4xl">Стоимость</h2>
            <p className="mt-3 text-[var(--color-fg-muted)]">
              Одна проверка = один AI-разбор одного ответа по одному заданию.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="text-sm text-[var(--color-fg-muted)]">Пробный тест</div>
                <div className="flex items-baseline gap-2">
                  <span className="font-[var(--font-serif)] text-4xl">0 ₽</span>
                  <span className="text-sm text-[var(--color-fg-muted)]">попробуйте сами</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[var(--color-fg-muted)]">
                <p>• Все 4 задания любого варианта.</p>
                <p>• Записи можно прослушать и скачать.</p>
                <p>• Без AI-разбора — только запись.</p>
              </CardContent>
            </Card>
            <Card className="border-[var(--color-accent)] ring-1 ring-[var(--color-accent-soft)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-[var(--color-fg-muted)]">Пакет разборов</div>
                  <Badge variant="accent">Выгодно</Badge>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-[var(--font-serif)] text-4xl">399 ₽</span>
                  <span className="text-sm text-[var(--color-fg-muted)]">
                    за 5 проверок · 80 ₽/шт
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[var(--color-fg-muted)]">
                <p>• Полный разбор по критериям ФИПИ.</p>
                <p>• Балл по каждому критерию + советы.</p>
                <p>• Транскрипт речи + ошибки произношения.</p>
                <p className="pt-2 text-xs text-[var(--color-fg-subtle)]">
                  Одна проверка также доступна за 99 ₽.
                </p>
              </CardContent>
            </Card>
          </div>
        </Container>
      </section>

      {/* ── Финальный CTA ──────────────────────────────────────────── */}
      <section className="py-20">
        <Container>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
            <h2 className="font-[var(--font-serif)] text-3xl">Готовы попробовать?</h2>
            <p className="mt-3 text-[var(--color-fg-muted)]">
              Регистрация — 30 секунд. После регистрации сразу открывается каталог вариантов.
            </p>
            <Link
              href="/register"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-8")}
            >
              Создать аккаунт
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}
