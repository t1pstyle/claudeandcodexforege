"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { commonClipUrl, primeAndPlay } from "@/lib/exam/audio";

/**
 * Пре-флайт экран перед началом экзамена:
 *  - список микрофонов (enumerateDevices),
 *  - живой индикатор уровня сигнала (Web Audio analyser),
 *  - короткая тестовая запись 3 секунды и плеер,
 *  - кнопка «Начать экзамен» — активируется, когда выбран микрофон.
 *
 * После клика на «Начать» отдаёт наружу выбранный deviceId,
 * ExamRunner использует его при prepareMic() — так пользователь гарантированно
 * говорит в тот же микрофон, в который он только что убедился, что слышен.
 *
 * Здесь собственный getUserMedia-стрим, который мы закрываем при старте
 * экзамена — дальше новый стрим откроет useRecorder уже внутри runner'а.
 */

export interface PreflightResult {
  deviceId: string;
}

export function Preflight({
  onReady,
  onCancel,
}: {
  onReady: (r: PreflightResult) => void;
  onCancel: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [permission, setPermission] = useState<"idle" | "granted" | "denied">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState(0); // 0..100, RMS уровень
  const [testingState, setTestingState] = useState<"idle" | "recording" | "ready">(
    "idle"
  );
  const [testUrl, setTestUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // ── 1. Запрашиваем разрешение и забираем список устройств ──────
  const start = useCallback(async (preferId?: string) => {
    setError(null);
    try {
      // Закрываем старый стрим, если был (смена устройства).
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const constraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (preferId) constraints.deviceId = { exact: preferId };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
      });
      streamRef.current = stream;
      setPermission("granted");

      // Имена устройств появляются только после разрешения.
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "audioinput"
      );
      setDevices(list);
      // Если deviceId ещё не выбран — возьмём из активного трека.
      if (!deviceId) {
        const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
        setDeviceId(activeId ?? list[0]?.deviceId ?? "");
      }

      // Запускаем анализатор уровня.
      startMeter(stream);
    } catch (err) {
      const isDenied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setPermission(isDenied ? "denied" : "idle");
      setError(
        isDenied
          ? "Нужен доступ к микрофону. Разрешите его в настройках браузера."
          : err instanceof Error
            ? err.message
            : "Микрофон недоступен"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startMeter = (stream: MediaStream) => {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // RMS отклонение от 128 (тишина).
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const db = Math.min(100, Math.max(0, rms * 260));
        setLevel(db);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* уровень не критичен — пропустим */
    }
  };

  // ── 2. Первый заход — автоматически запросим микрофон ──────────
  useEffect(() => {
    void start();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      if (recorderRef.current?.state === "recording") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, [start]);

  // ── 3. Смена устройства перезапускает стрим и анализатор ───────
  const onChangeDevice = async (id: string) => {
    setDeviceId(id);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    await audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    await start(id);
  };

  // ── 4. Тестовая запись 3 секунды ───────────────────────────────
  const handleTest = async () => {
    if (!streamRef.current) return;
    if (testUrl) URL.revokeObjectURL(testUrl);
    setTestUrl(null);
    setTestingState("recording");
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(streamRef.current);
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      setTestUrl(URL.createObjectURL(blob));
      setTestingState("ready");
    };
    rec.start();
    setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, 3000);
  };

  // Состояние: запустили ли уже интро-объявление.
  const [starting, setStarting] = useState(false);

  // ── 5. Перейти к экзамену ──────────────────────────────────────
  // Клик пользователя — единственный момент, когда браузер разрешает
  // audio.play() без отказа. Поэтому прямо тут, синхронно в обработчике,
  // стартуем интро-объявление («Now we are ready to start. Task 1»).
  // Как только mp3 доигрался — освобождаем микрофонный стрим и зовём
  // onReady(); ExamRunner подхватит и начнёт Task 1 сразу с 5-сек отсчёта.
  const handleContinue = () => {
    if (!deviceId || permission !== "granted") return;
    if (starting) return;
    setStarting(true);
    primeAndPlay(commonClipUrl("intro-task-1"), () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      if (testUrl) URL.revokeObjectURL(testUrl);
      onReady({ deviceId });
    });
  };

  const canContinue = permission === "granted" && !!deviceId && !starting;

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-white">
      <div className="mx-auto w-full max-w-[880px] px-6 py-14">
        <div className="font-[var(--font-serif)] uppercase tracking-[0.35em] text-xs text-[var(--color-fg-muted)]">
          Подготовка
        </div>
        <h1 className="mt-2 font-[var(--font-serif)] text-3xl text-[var(--color-fg)]">
          Проверка микрофона
        </h1>

        {error && (
          <div className="mt-6 border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] p-4 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {/* ── Выбор микрофона ───────────────────────────────── */}
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
              Микрофон
            </label>
            <select
              value={deviceId}
              onChange={(e) => void onChangeDevice(e.target.value)}
              disabled={permission !== "granted"}
              className="mt-2 block w-full border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            >
              {devices.length === 0 && <option value="">—</option>}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Микрофон ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>

            {/* Живой индикатор уровня */}
            <div className="mt-5">
              <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
                Уровень сигнала
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden bg-[var(--color-surface-muted)]">
                <div
                  className={
                    "h-full transition-[width] duration-75 " +
                    (level > 70
                      ? "bg-[var(--color-danger)]"
                      : level > 20
                        ? "bg-[var(--color-accent)]"
                        : "bg-[var(--color-fg)]/30")
                  }
                  style={{ width: `${level}%` }}
                />
              </div>
            </div>
          </div>

          {/* ── Тестовая запись ────────────────────────────── */}
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
              Тест-запись
            </div>
            <button
              onClick={handleTest}
              disabled={permission !== "granted" || testingState === "recording"}
              className="mt-3 h-10 min-w-[200px] border border-[var(--color-fg)]/30 bg-white px-4 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              {testingState === "recording"
                ? "Запись 3 сек…"
                : testingState === "ready"
                  ? "Записать снова"
                  : "Проверить микрофон"}
            </button>
            {testUrl && (
              <audio
                controls
                src={testUrl}
                preload="metadata"
                className="mt-3 w-full max-w-[320px]"
              />
            )}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onCancel}
            className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            ← Назад к варианту
          </button>
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className="h-11 min-w-[240px] bg-[var(--color-accent)] px-6 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {starting ? "Подождите…" : "Начать экзамен →"}
          </button>
        </div>
      </div>

      {/* Полноэкранный overlay пока проигрывается интро-объявление. */}
      {starting && (
        <div className="fixed inset-x-0 bottom-0 top-12 z-40 flex items-center justify-center bg-[var(--color-fg)] px-6 text-center text-white">
          <div>
            <div className="font-[var(--font-serif)] uppercase tracking-[0.4em] text-xs text-white/60">
              Task 1
            </div>
            <div className="mt-3 font-[var(--font-serif)] text-4xl sm:text-5xl md:text-6xl">
              Now we are ready to start
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
