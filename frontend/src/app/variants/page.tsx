import Link from "next/link";
import type { Metadata } from "next";

import { Container } from "@/components/ui/container";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { listVariants } from "@/lib/api/endpoints";

export const metadata: Metadata = { title: "Варианты" };

// Публичная: варианты можно смотреть без логина, но попытаться
// их решить можно только авторизованным (проверка внутри /variants/[id]/exam).
// SSR — каталог редко меняется, кэшируем на 60 секунд.
export const revalidate = 60;

export default async function VariantsPage() {
  let variants: Awaited<ReturnType<typeof listVariants>> = [];
  let error: string | null = null;

  try {
    variants = await listVariants();
  } catch (err) {
    error = err instanceof Error ? err.message : "Не удалось загрузить варианты";
  }

  return (
    <Container className="py-12">
      <h1 className="font-[var(--font-serif)] text-3xl md:text-4xl">Каталог вариантов</h1>
      <p className="mt-3 max-w-2xl text-[var(--color-fg-muted)]">
        Полный набор из демоверсий и тренировочных комплектов. Выберите любой и
        пройдите все четыре задания подряд — как на экзамене.
      </p>

      {error ? (
        <div className="mt-10 rounded-[var(--radius-md)] border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] p-4 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : variants.length === 0 ? (
        <div className="mt-10 text-[var(--color-fg-muted)]">Пока пусто — скоро добавим.</div>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {variants.map((v) => (
            <Link key={v.id} href={`/variants/${v.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-[var(--shadow-md)]">
                <CardHeader>
                  <CardTitle>{v.title}</CardTitle>
                  {v.description && <CardDescription>{v.description}</CardDescription>}
                  <div className="mt-4 text-xs text-[var(--color-fg-subtle)]">
                    Добавлен{" "}
                    {new Date(v.created_at).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Container>
  );
}
