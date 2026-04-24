import type { ExamTaskRead, SubmissionRead } from "@/lib/api/endpoints";

/**
 * Единый справочник по типам заданий: как называть в UI, какой цвет бейджа,
 * какой максимум баллов. Используется всюду, где отображается задание.
 */
export const TASK_TYPE_META: Record<
  ExamTaskRead["task_type"],
  { title: string; short: string; maxScore: number; number: 1 | 2 | 3 | 4 }
> = {
  reading_aloud: { title: "Чтение вслух", short: "Чтение", maxScore: 1, number: 1 },
  compose_questions: { title: "Четыре вопроса", short: "Вопросы", maxScore: 4, number: 2 },
  interview_answers: { title: "Интервью", short: "Интервью", maxScore: 5, number: 3 },
  photo_based_statement: { title: "Монолог по фото", short: "Монолог", maxScore: 10, number: 4 },
};

export const STATUS_META: Record<
  SubmissionRead["status"],
  { label: string; variant: "neutral" | "accent" | "success" | "warning" | "danger" }
> = {
  uploaded: { label: "Сохранено", variant: "neutral" },
  pending_ai: { label: "В очереди", variant: "warning" },
  processing: { label: "Обработка", variant: "accent" },
  evaluated: { label: "Готово", variant: "success" },
  failed: { label: "Ошибка", variant: "danger" },
};
