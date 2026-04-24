"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Обратный отсчёт в секундах.
 *
 * Особенности:
 * - запускается только при active=true (фазы "preparation"/"recording"),
 *   в idle-фазах таймер не тикает и не ест батарею;
 * - при смене duration или active перезапускается «с чистого листа»;
 * - onExpire дёргаем ровно один раз — когда счётчик дошёл до 0.
 *
 * Мы специально не используем performance.now() для мс-точности —
 * пользователю нужна секундная индикация, а лишние рендеры вредят плавности.
 */
export function useCountdown({
  duration,
  active,
  onExpire,
}: {
  duration: number;
  active: boolean;
  onExpire: () => void;
}): number {
  const [secondsLeft, setSecondsLeft] = useState(duration);
  // Держим onExpire в ref, чтобы таймер не перезапускался, если callback
  // пересоздаётся на каждом рендере (а он будет — мы его определяем в ExamRunner).
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!active) {
      setSecondsLeft(duration);
      return;
    }
    setSecondsLeft(duration);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, duration - elapsed);
      setSecondsLeft(left);
      if (left === 0) {
        clearInterval(interval);
        // Чуть отложим, чтобы UI успел отрисовать "00:00".
        setTimeout(() => expireRef.current(), 50);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [duration, active]);

  return secondsLeft;
}
