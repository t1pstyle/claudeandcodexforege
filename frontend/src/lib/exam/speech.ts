"use client";

/**
 * Обёртка над window.speechSynthesis.
 *
 * Особенности:
 * - Голоса в SpeechSynthesis загружаются асинхронно — ждём onvoiceschanged,
 *   иначе первая фраза в Chrome/Windows молчит.
 * - Если API недоступен (SSR/старый браузер) — speak() немедленно резолвится,
 *   UI просто показывает текст на экране, экзамен не зависает.
 * - cancel() чистит очередь, чтобы на выходе из задания не висели хвосты.
 */

let voicesReadyPromise: Promise<void> | null = null;

function ensureVoicesLoaded(): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve();
  }
  if (voicesReadyPromise) return voicesReadyPromise;

  voicesReadyPromise = new Promise((resolve) => {
    const have = window.speechSynthesis.getVoices();
    if (have.length > 0) return resolve();
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Страховка — иногда событие не стреляет.
    setTimeout(resolve, 1500);
  });
  return voicesReadyPromise;
}

/**
 * Проговорить фразу и дождаться её окончания.
 * Если TTS недоступен или сбой — резолвится без ошибки (UX важнее).
 */
export async function speak(
  text: string,
  opts: { lang?: string; rate?: number; pitch?: number } = {}
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  await ensureVoicesLoaded();

  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang ?? "en-US";
      u.rate = opts.rate ?? 0.95;
      u.pitch = opts.pitch ?? 1;

      // Подберём более натуральный английский голос, если он есть.
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /Samantha|Alex|Google US English|Microsoft Aria/i.test(v.name)) ||
        voices.find((v) => v.lang?.startsWith("en"));
      if (preferred) u.voice = preferred;

      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);

      // Страховка: если браузер «застрянет», резолвим сами через таймаут,
      // пропорциональный длине фразы.
      const safety = Math.max(3000, text.length * 90);
      setTimeout(() => resolve(), safety);
    } catch {
      resolve();
    }
  });
}

/** Отменить все текущие/очередные фразы (вызываем при exit/unmount). */
export function cancelSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
