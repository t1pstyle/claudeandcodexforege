import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ApiError } from "@/lib/api/client";
import { getVariant } from "@/lib/api/endpoints";
import { ExamRunner } from "@/components/exam/exam-runner";

export const metadata: Metadata = { title: "Режим теста" };

/**
 * Запуск варианта целиком. Серверно фетчим полный вариант с 4 заданиями
 * и отдаём в клиентский ExamRunner, который ведёт state machine
 * (номер текущего задания, фаза, таймеры — всё появится в Step 9).
 *
 * Проходится без возможности вернуться назад — как на настоящем экзамене.
 */
export default async function ExamPage({
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

  return <ExamRunner variant={variant} />;
}
