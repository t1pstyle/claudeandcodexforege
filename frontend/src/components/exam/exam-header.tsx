"use client";

import Link from "next/link";

/**
 * Шапка «режима теста». Визуально строгая:
 * - узкая тёмная полоса (h-12), без скруглений;
 * - слева — номер задания и его тип;
 * - по центру — индикатор фазы (Подготовка / Ответ) с большим моноширинным таймером;
 * - справа — кнопка «Выйти» возврата на список заданий варианта.
 *
 * Цвет не терракотовый — в тесте отвлекающих акцентов быть не должно.
 */
export function ExamHeader({
  taskNumber,
  taskTitle,
  exitHref,
  phase,
  secondsLeft,
  totalSec,
}: {
  taskNumber: 1 | 2 | 3 | 4;
  taskTitle: string;
  exitHref: string;
  /** Пока диктофона нет, показываем "idle" — готов начать. */
  phase?: "idle" | "preparation" | "answer";
  secondsLeft?: number;
  /** Полная длительность текущей фазы — для прогресс-бара под шапкой. */
  totalSec?: number;
}) {
  const phaseLabel =
    phase === "preparation" ? "Подготовка" :
    phase === "answer" ? "Ответ" :
    "Готовность";

  // Прогресс-бар заполняется по мере того, как время фазы истекает.
  const hasProgress =
    totalSec !== undefined &&
    totalSec > 0 &&
    secondsLeft !== undefined &&
    (phase === "preparation" || phase === "answer");
  const progressPct = hasProgress
    ? Math.min(100, Math.max(0, ((totalSec! - secondsLeft!) / totalSec!) * 100))
    : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-black/20 bg-[#1f1e1c] text-white">
      <div className="flex h-12 items-center justify-between px-6">
        {/* ── Левая часть: номер и название ────────────────────────── */}
        <div className="flex items-center gap-3 text-sm">
          <span className="font-[var(--font-serif)] text-white/60 uppercase tracking-[0.25em]">
            Задание {taskNumber}
          </span>
          <span aria-hidden className="text-white/30">·</span>
          <span className="font-medium">{taskTitle}</span>
        </div>

        {/* ── Центр: индикатор фазы ────────────────────────────────── */}
        <div className="hidden sm:flex items-center gap-3 text-sm">
          <span className="text-white/60 uppercase tracking-[0.2em] text-xs">
            {phaseLabel}
          </span>
          <span className="font-mono tabular-nums text-base">
            {formatMmSs(secondsLeft)}
          </span>
        </div>

        {/* ── Правая часть: выход ──────────────────────────────────── */}
        <Link
          href={exitHref}
          className="text-sm text-white/70 hover:text-white transition-colors"
        >
          Выйти
        </Link>
      </div>
      {/* Прогресс-бар фазы. Пустой «рельс» виден всегда — чтобы шапка не
          прыгала на 2px между фазами. Заполняется синим. */}
      <div className="h-[3px] w-full bg-white/10">
        <div
          className="h-full bg-[#3b82f6] transition-[width] duration-500 ease-linear"
          style={{ width: hasProgress ? `${progressPct}%` : "0%" }}
        />
      </div>
    </header>
  );
}

function formatMmSs(totalSeconds: number | undefined) {
  if (totalSeconds === undefined) return "—:—";
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
