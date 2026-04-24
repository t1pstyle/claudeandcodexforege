/**
 * Утилиты для извлечения под-пунктов из prompt_text / support_material.
 *
 * Мы не правим бэкенд прямо сейчас, поэтому 4 «направления» Task 2 и
 * 5 вопросов Task 3 парсим из уже имеющихся строковых полей.
 *
 * Форматы из демо-варианта:
 *   Task 2 (compose_questions) — в prompt_text есть блок вида:
 *       1) location of the language school
 *       2) course duration
 *       3) group size
 *       4) discounts for students
 *   Task 3 (interview_answers) — в support_material:
 *       1. How often do you read books and why?
 *       2. ...
 */

/** Достаёт пронумерованные строки "1) ..." или "1. ..." в виде массива. */
export function extractNumberedLines(text: string | null | undefined): string[] {
  if (!text) return [];
  // Разбиваем на строки, ищем начинающиеся с N) или N.
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(\d+)[.)]\s*(.+?)\s*$/);
    if (m) result.push(m[2]);
  }
  return result;
}

/**
 * Текст prompt_text без списка направлений — то, что показывается как
 * «общая инструкция» (до блока 1) ... 2) ...).
 */
export function stripNumberedTail(text: string): string {
  const idx = text.search(/\n\s*\d+[.)]\s+/);
  if (idx === -1) return text;
  return text.slice(0, idx).trim();
}

/** Task 2: вернуть 4 aim'а (или сколько их есть в prompt_text). */
export function parseTask2Aims(promptText: string): string[] {
  return extractNumberedLines(promptText);
}

/** Task 3: вернуть 5 вопросов (или сколько их есть в support_material). */
export function parseTask3Questions(
  supportMaterial: string | null | undefined
): string[] {
  return extractNumberedLines(supportMaterial);
}
