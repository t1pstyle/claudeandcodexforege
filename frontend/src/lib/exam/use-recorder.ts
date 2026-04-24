"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Обёртка над MediaRecorder, живущая в компоненте экзамена.
 *
 * Хук владеет:
 * - MediaStream (микрофон),
 * - MediaRecorder,
 * - накопленным Blob после остановки.
 *
 * Важные решения:
 * 1. Стрим получаем лениво — при первом start(), а не при монтировании,
 *    чтобы не просить микрофон у пользователя до того, как он нажал кнопку.
 * 2. Держим один стрим на всё прохождение варианта (releaseOnUnmount=true),
 *    чтобы не дёргать разрешение микрофона перед каждым из 4 заданий.
 *    Между заданиями просто пересоздаём MediaRecorder на том же стриме.
 * 3. MIME-тип подбираем по фактической поддержке (Safari не умеет webm/opus).
 * 4. При unmount останавливаем запись, закрываем треки — без утечек.
 */

export type RecorderState =
  | "inactive"
  | "requesting" // ждём разрешения микрофона
  | "ready"      // стрим получен, готов писать
  | "recording"
  | "denied"     // пользователь отказал / микрофон недоступен
  | "error";

export interface Recording {
  blob: Blob;
  mimeType: string;
  /** Длительность в секундах (примерная, по таймеру ответа). */
  durationSec: number;
  /** object URL для <audio src>. Отзывается при размонтировании. */
  url: string;
}

interface UseRecorderReturn {
  state: RecorderState;
  error: string | null;
  /**
   * Запросить разрешение микрофона, не начиная записи.
   * deviceId — необязательный: если передан, берём именно этот input-device
   * (пользователь выбрал на preflight-экране).
   */
  prepareMic: (deviceId?: string) => Promise<void>;
  /** Начать запись (требует, чтобы микрофон уже был получен). */
  start: () => Promise<void>;
  /** Остановить запись. Возвращает готовый Recording, либо null при ошибке. */
  stop: (durationSec: number) => Promise<Recording | null>;
  /** Полностью освободить микрофон (конец сессии). */
  release: () => void;
}

/** Подобрать лучший поддерживаемый MIME из того, что примет бэкенд. */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4", // Safari
    "audio/mpeg",
  ];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return "";
}

/** Расширение файла из MIME, для POST /submissions. */
export function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export function useRecorder(): UseRecorderReturn {
  const [state, setState] = useState<RecorderState>("inactive");
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  /**
   * Получить (или переиспользовать) поток микрофона.
   * Разделено с `start`, чтобы будущий UI мог «прогреть» микрофон заранее.
   */
  const ensureStream = useCallback(
    async (deviceId?: string): Promise<MediaStream> => {
      if (streamRef.current) return streamRef.current;
      setState("requesting");
      setError(null);
      try {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (deviceId) audioConstraints.deviceId = { exact: deviceId };
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        streamRef.current = stream;
        return stream;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Microphone unavailable";
        // NotAllowedError / PermissionDeniedError → пользователь отказал.
        const isDenied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        setState(isDenied ? "denied" : "error");
        setError(
          isDenied
            ? "Нужен доступ к микрофону. Разрешите его в настройках браузера."
            : msg
        );
        throw err;
      }
    },
    []
  );

  const start = useCallback(async () => {
    const stream = await ensureStream();
    const mimeType = pickMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream); // браузер сам выберет
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start(250); // тикаем чанками по 250ms, чтобы ничего не терялось
    setState("recording");
  }, [ensureStream]);

  const stop = useCallback(
    (durationSec: number): Promise<Recording | null> => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: mimeType });
          chunksRef.current = [];
          const url = URL.createObjectURL(blob);
          setState("ready");
          resolve({ blob, mimeType, durationSec, url });
        };
        recorder.stop();
      });
    },
    []
  );

  const release = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState("inactive");
  }, []);

  // Финальная уборка при размонтировании (пользователь ушёл со страницы).
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const prepareMic = useCallback(
    async (deviceId?: string) => {
      await ensureStream(deviceId);
      setState("ready");
    },
    [ensureStream]
  );

  return { state, error, prepareMic, start, stop, release };
}
