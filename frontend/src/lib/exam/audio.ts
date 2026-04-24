"use client";

import { API_BASE_URL } from "@/lib/api/client";
import { speak } from "./speech";

/**
 * Проигрывание голосовых объявлений экзамена.
 *
 * ВАЖНО про autoplay-policy:
 * Браузеры блокируют audio.play() вне user-gesture. Первый play() должен
 * произойти синхронно внутри обработчика клика (см. primeAndPlay — вызывается
 * из Preflight при нажатии «Начать экзамен»). После успешного первого
 * воспроизведения этот конкретный <audio>-элемент остаётся «разблокирован» —
 * и все последующие playCommon/playClip работают, даже когда между ними
 * есть await'ы к микрофону и пр.
 *
 * Если mp3 не прогрузился или play() отвергнут — fallback на speak().
 */

export type CommonClip =
  | "intro-task-1"
  | "task-2"
  | "task-3"
  | "task-4"
  | "start-speaking"
  | "question-1"
  | "question-2"
  | "question-3"
  | "question-4"
  | "question-5"
  | "beep";

export function commonClipUrl(name: CommonClip): string {
  return `${API_BASE_URL}/static/tts/common/${name}.mp3`;
}

export function absoluteAudioUrl(pathOrUrl: string | undefined | null): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl}`;
}

// ── Shared <audio> ───────────────────────────────────────────────────
let sharedAudio: HTMLAudioElement | null = null;

function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

/**
 * Сыграть mp3 и дождаться окончания.
 * Возвращает true — отыграло до конца, false — play() отвергнут / onerror.
 *
 * maxDurationMs — страховка на случай, когда браузер не стреляет onended
 * (например, потерялся поток). По умолчанию 12 секунд (достаточно для самых
 * длинных наших фраз; интервью-вопросы редко дольше).
 */
function playUrl(url: string, maxDurationMs = 12000): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = getSharedAudio();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      audio.onended = null;
      audio.onerror = null;
      resolve(ok);
    };

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
    audio.currentTime = 0;

    const safety = setTimeout(() => finish(true), maxDurationMs);

    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        // autoplay blocked / src invalid — сразу отдаём false, без ожидания.
        finish(false);
      });
    }
  });
}

/**
 * Синхронная точка входа: вызывается из обработчика клика пользователя
 * («Начать экзамен»). Стартует воспроизведение внутри user-gesture —
 * это «разблокирует» shared-audio на всю сессию, плюс одновременно
 * произносит интро-объявление («Now we are ready to start. Task 1.»).
 *
 * onDone — коллбэк, когда аудио закончилось (или истекла страховка).
 * Вызывается ровно один раз.
 *
 * Все побочные async-работы — внутри, Preflight просто передаёт callback.
 */
export function primeAndPlay(url: string, onDone: () => void): void {
  const audio = getSharedAudio();
  let fired = false;
  const done = () => {
    if (fired) return;
    fired = true;
    audio.onended = null;
    audio.onerror = null;
    onDone();
  };
  audio.onended = done;
  audio.onerror = done;
  audio.src = url;
  audio.currentTime = 0;
  const p = audio.play();
  if (p && typeof p.then === "function") {
    p.catch(() => done());
  }
  // Жёсткая страховка, чтобы «Начать» не висел навсегда, если аудио не отдаётся.
  setTimeout(done, 12000);
}

// ── Публичные хелперы для ExamRunner ──────────────────────────────────

export async function playCommon(
  name: CommonClip,
  fallbackText?: string
): Promise<void> {
  const ok = await playUrl(commonClipUrl(name));
  if (!ok && fallbackText) await speak(fallbackText);
}

export async function playClip(
  pathOrUrl: string | null | undefined,
  fallbackText: string
): Promise<void> {
  const url = absoluteAudioUrl(pathOrUrl ?? "");
  if (url) {
    const ok = await playUrl(url);
    if (ok) return;
  }
  await speak(fallbackText);
}

/** Короткий «бип» — между под-вопросами Task 2/3 (как на реальном экзамене). */
export async function playBeep(): Promise<void> {
  await playUrl(commonClipUrl("beep"), 2000);
}

export function stopAudio() {
  if (sharedAudio) {
    try {
      sharedAudio.pause();
      sharedAudio.src = "";
    } catch {
      /* ignore */
    }
  }
}
