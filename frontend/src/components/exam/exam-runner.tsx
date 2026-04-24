"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ExamHeader } from "@/components/exam/exam-header";
import { Preflight } from "@/components/exam/preflight";
import { TASK_TYPE_META } from "@/lib/task-meta";
import { useAuth } from "@/lib/auth/store";
import { API_BASE_URL } from "@/lib/api/client";
import {
  uploadSubmission,
  type ExamVariantRead,
  type ExamTaskRead,
} from "@/lib/api/endpoints";
import {
  useRecorder,
  extensionForMime,
  type Recording,
} from "@/lib/exam/use-recorder";
import { downloadBlob, mergeRecordingsToWav } from "@/lib/exam/export";
import { cancelSpeech } from "@/lib/exam/speech";
import { playCommon, playClip, playBeep, stopAudio } from "@/lib/exam/audio";
import {
  parseTask2Aims,
  parseTask3Questions,
  stripNumberedTail,
} from "@/lib/exam/parse-task";

/**
 * Клиентский движок прохождения варианта.
 *
 * Верхний уровень — три стадии: preflight → running → finished.
 *
 * В running работает один большой async-планировщик (runExam), который
 * последовательно прогоняет 4 задания по формату ЕГЭ:
 *
 *   Task 1 (reading_aloud)
 *     announce → 5с ready → prep → 5с ready → «Start speaking» → запись
 *   Task 2 (compose_questions)
 *     announce → 5с ready → prep (с объявлением и 4 aim'ами) →
 *     для i=1..4: «Question i» → сигнал перехода → 20с записи (на экране только aim i)
 *   Task 3 (interview_answers)
 *     announce → 5с ready → prep (БЕЗ вопросов) →
 *     для i=1..5: TTS озвучивает вопрос → сигнал перехода → 40с записи
 *   Task 4 (photo_based_statement)
 *     announce → 5с ready → prep → 5с ready → «Start speaking» → запись
 *
 * Перед Task 1 дополнительно говорится «Now we are ready to start.»,
 * для Task 2/3/4 — только «Task N.».
 *
 * На стадию preflight повесили выбор микрофона и тест-запись. Стадия
 * running стартует только после клика «Начать экзамен».
 *
 * Бизнес-правило: /variants/[id]/exam НЕ закрыта RequireAuth. Записи
 * делаются в память и отправляются на AI только на FinishedScreen — там
 * стоит auth-гейт.
 */

type Stage = "preflight" | "running" | "finished";

/** «Большое объявление» поверх всего экрана (TTS + крупный текст). */
interface Overlay {
  title: string;
  subtitle?: string;
  /** Если number — показываем крупный обратный отсчёт «5…1». */
  countdown?: number;
}

interface PhaseInfo {
  label: string; // "Подготовка" / "Ответ" / "Приготовьтесь" / ""
  secondsLeft: number; // для Timer в шапке
  kind: "idle" | "preparation" | "answer";
  /** Полная длительность текущей фазы — для прогресс-бара и кнопок. */
  totalSec: number;
}

/** Во время Task 2/3 подменяем материал на текущий пункт. */
interface Focus {
  /** 0-based индекс текущего под-вопроса. undefined — показывать материал целиком. */
  index?: number;
  total: number;
  /** То, что выводить на экран вместо полного материала. */
  text?: string;
}

const READY_PAUSE_SEC = 5;

export function ExamRunner({ variant }: { variant: ExamVariantRead }) {
  const [stage, setStage] = useState<Stage>("preflight");
  const [deviceId, setDeviceId] = useState<string>("");

  const tasks = useMemo(
    () => [...variant.tasks].sort((a, b) => a.task_number - b.task_number),
    [variant.tasks]
  );

  if (stage === "preflight") {
    return (
      <>
        <ExamHeader
          taskNumber={1}
          taskTitle="Проверка микрофона"
          exitHref={`/variants/${variant.id}`}
        />
        <Preflight
          onReady={({ deviceId }) => {
            setDeviceId(deviceId);
            setStage("running");
          }}
          onCancel={() => {
            // Просто редирект силами ExamHeader-ссылки «Выйти»; программный
            // переход здесь не нужен — onCancel вызовется тем же Link.
          }}
        />
      </>
    );
  }

  if (stage === "finished") {
    // Обработано внутри RunningExam, но на всякий — здесь мы не должны оказаться.
    return null;
  }

  return (
    <RunningExam
      variant={variant}
      tasks={tasks}
      deviceId={deviceId}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────
   RunningExam — сам экзамен с планировщиком.
   ───────────────────────────────────────────────────────────────────── */

function RunningExam({
  variant,
  tasks,
  deviceId,
}: {
  variant: ExamVariantRead;
  tasks: ExamTaskRead[];
  deviceId: string;
}) {
  const recorder = useRecorder();

  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<PhaseInfo>({
    label: "",
    secondsLeft: 0,
    kind: "idle",
    totalSec: 0,
  });
  // Флаг «пропустить текущую фазу»: ставится кликом по кнопке в SideTimerPanel,
  // runCountdown() в конце каждой секунды видит его и выходит.
  const skipRef = useRef(false);
  const skipPhase = () => {
    skipRef.current = true;
  };
  // Покажем оверлей «Task 1» сразу при монтировании — чтобы не мелькал пустой
  // экран пока runExam() ждёт prepareMic(). countdownReady() перезапишет его.
  const [overlay, setOverlay] = useState<Overlay | null>({
    title: "Task 1",
  });
  const [focus, setFocus] = useState<Focus | null>(null);
  const [recordings, setRecordings] = useState<Record<string, Recording>>({});
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // Локальный токен отмены — свой у каждой активации эффекта. В Strict Mode
    // в dev компонент монтируется дважды; токен гарантирует, что первая
    // (отменённая) runExam не продолжит менять state поверх второй.
    const token = { cancelled: false };

    // prepareMic требует явного клика пользователя в Chrome policy, но у нас
    // уже был клик в preflight — user-gesture ещё «горячий». Даже если нет —
    // поток откроется без модала, т.к. страница уже получала getUserMedia.
    void runExam(token);

    return () => {
      token.cancelled = true;
      cancelSpeech();
      stopAudio();
      try {
        void recorder.stop(0); // если запись шла — остановим
      } catch {
        /* ignore */
      }
      recorder.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Примитивы планировщика ───────────────────────────────────────
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Все хелперы и основной сценарий определены внутри runExam(token) —
  // так каждая активация useEffect получает собственный замкнутый alive()
  // и не интерферирует с другой (актуально для React Strict Mode в dev).

  // ── Основной сценарий ────────────────────────────────────────────
  async function runExam(token: { cancelled: boolean }) {
    const alive = () => !token.cancelled;

    const announce = async (args: {
      clip?: import("@/lib/exam/audio").CommonClip;
      audioUrl?: string | null;
      fallback: string;
      title: string;
      subtitle?: string;
    }) => {
      if (!alive()) return;
      setOverlay({ title: args.title, subtitle: args.subtitle });
      if (args.clip) {
        await playCommon(args.clip, args.fallback);
      } else if (args.audioUrl !== undefined) {
        await playClip(args.audioUrl, args.fallback);
      }
      if (!alive()) return;
      setOverlay(null);
    };

    const countdownReady = async (seconds: number = READY_PAUSE_SEC) => {
      for (let s = seconds; s >= 1; s--) {
        if (!alive()) return;
        setOverlay({
          title: "Приготовьтесь",
          subtitle: "Начинаем через",
          countdown: s,
        });
        await sleep(1000);
      }
      if (!alive()) return;
      setOverlay(null);
    };

    // Возвращает true, если фаза дошла до конца, и false — если пропустили
    // кнопкой «Пропустить / Закончить». Запись Task 1/4 слушает это и сразу
    // останавливает recorder — как на реальном экзамене, где по щелчку
    // «Закончить» ответ прерывается.
    const runCountdown = async (
      durationSec: number,
      label: string,
      kind: PhaseInfo["kind"]
    ): Promise<boolean> => {
      skipRef.current = false;
      for (let s = durationSec; s >= 0; s--) {
        if (!alive()) return false;
        if (skipRef.current) {
          // Сбросим таймер в 0 — чтобы шапка и прогресс-бар показали финал.
          setPhase({ label, secondsLeft: 0, kind, totalSec: durationSec });
          skipRef.current = false;
          return false;
        }
        setPhase({ label, secondsLeft: s, kind, totalSec: durationSec });
        if (s > 0) await sleep(1000);
      }
      return true;
    };

    try {
      // Даём микрофону поднять стрим. Если пользователь отказал в preflight —
      // сюда не пришли бы; если вдруг отвалился — ошибка будет в recorder.error,
      // которую покажем баннером (см. ниже).
      await recorder.prepareMic(deviceId || undefined);
    } catch {
      // UI ниже покажет сообщение.
      return;
    }

    for (let i = 0; i < tasks.length; i++) {
      if (!alive()) return;
      const task = tasks[i];
      setCurrentIdx(i);
      setFocus(null);

      // 1) Объявление «Task N». Для Task 1 интро («Now we are ready to start.
      // Task 1») уже проиграно в Preflight внутри user-gesture, поэтому здесь
      // мы просто даём короткую паузу и идём к 5-сек отсчёту.
      const isFirst = i === 0;
      if (!isFirst) {
        const taskClip = (`task-${task.task_number}` as const);
        await announce({
          clip: taskClip as "task-2" | "task-3" | "task-4",
          fallback: `Task ${task.task_number}.`,
          title: `Task ${task.task_number}`,
        });
      }
      if (!alive()) return;

      // 2) 5-секундный отсчёт перед подготовкой.
      await countdownReady();
      if (!alive()) return;

      // 3) Подготовка.
      await runCountdown(task.prep_seconds, "Подготовка", "preparation");
      if (!alive()) return;

      // 4) Ветки по типу задания.
      let rec: Recording | null = null;

      if (
        task.task_type === "reading_aloud" ||
        task.task_type === "photo_based_statement"
      ) {
        await countdownReady();
        await announce({
          clip: "start-speaking",
          fallback: "The time for preparation is over. Start speaking, please.",
          title: "Start speaking, please",
        });
        if (!alive()) return;
        await recorder.start();
        const startedAt = Date.now();
        await runCountdown(task.speak_seconds, "Ответ", "answer");
        // Если пользователь нажал «Закончить ответ», отсчёт прервался —
        // фиксируем фактическую длительность записи.
        const elapsed = Math.min(
          task.speak_seconds,
          Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        );
        rec = await recorder.stop(elapsed);
      } else if (task.task_type === "compose_questions") {
        const aims = parseTask2Aims(task.prompt_text);
        const total = aims.length || 4;
        await recorder.start();
        const startedAt = Date.now();
        for (let q = 0; q < total; q++) {
          if (!alive()) break;
          const clip = (`question-${q + 1}` as const);
          await announce({
            clip: clip as "question-1" | "question-2" | "question-3" | "question-4" | "question-5",
            fallback: `Question ${q + 1}.`,
            title: `Question ${q + 1}`,
            subtitle: `${q + 1} из ${total}`,
          });
          setFocus({ index: q, total, text: aims[q] });
          // Короткий сигнал означает переход к следующему пункту, как в реальном ЕГЭ.
          await playBeep();
          // «Закончить ответ» в Task 2/3 прерывает только текущий под-вопрос,
          // следующий начнётся сразу с объявления — как на реальном экзамене
          // («Остановка ответа → беп → следующий»).
          await runCountdown(20, "Ответ", "answer");
        }
        setFocus(null);
        const elapsed = Math.min(
          total * 20,
          Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        );
        rec = await recorder.stop(elapsed);
      } else if (task.task_type === "interview_answers") {
        const questions = parseTask3Questions(task.support_material);
        const audioUrls = task.interview_audio_urls ?? [];
        const total = questions.length || audioUrls.length || 5;
        await recorder.start();
        const startedAt = Date.now();
        for (let q = 0; q < total; q++) {
          if (!alive()) break;
          // Предпочитаем озвученный на бэкенде вопрос; на фолбэке — SpeechSynthesis.
          await announce({
            audioUrl: audioUrls[q] || null,
            fallback: questions[q] ?? `Question ${q + 1}.`,
            title: `Question ${q + 1}`,
            subtitle: `${q + 1} из ${total}`,
          });
          setFocus({ index: q, total }); // text не передаём — скрываем
          await playBeep();
          await runCountdown(40, "Ответ", "answer");
        }
        setFocus(null);
        const elapsed = Math.min(
          total * 40,
          Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        );
        rec = await recorder.stop(elapsed);
      }

      if (!alive()) return;
      if (rec) {
        setRecordings((prev) => ({ ...prev, [task.id]: rec! }));
      }
      setPhase({ label: "", secondsLeft: 0, kind: "idle", totalSec: 0 });
    }

    if (!alive()) return;
    recorder.release();
    setFinished(true);
  }

  if (finished) {
    return (
      <FinishedScreen
        variant={variant}
        tasks={tasks}
        recordings={recordings}
      />
    );
  }

  const task = tasks[currentIdx];
  const meta = TASK_TYPE_META[task.task_type];
  // До начала подготовки материал задания на экране не появляется.
  const materialVisible = phase.kind !== "idle";

  return (
    <>
      <ExamHeader
        taskNumber={meta.number}
        taskTitle={
          materialVisible
            ? `${currentIdx + 1} из ${tasks.length} · ${meta.title}`
            : `${currentIdx + 1} из ${tasks.length}`
        }
        exitHref={`/variants/${variant.id}`}
        phase={phase.kind}
        secondsLeft={phase.secondsLeft || undefined}
        totalSec={phase.totalSec || undefined}
      />

      <div className="flex-1 bg-white">
        <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {materialVisible && (
              <ExamMaterial task={task} focus={focus} phase={phase.kind} />
            )}
          </div>

          <aside className="lg:sticky lg:top-16 lg:self-start">
            <SideTimerPanel
              taskNumber={meta.number}
              taskTitle={materialVisible ? meta.title : "—"}
              phase={phase}
              focus={focus}
              totalTasks={tasks.length}
              currentIdx={currentIdx}
              recorderError={recorder.error}
              onSkip={skipPhase}
            />
          </aside>
        </div>
      </div>

      {overlay && <AnnouncementOverlay overlay={overlay} />}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Материал задания: левый столбец экзамена.
   ───────────────────────────────────────────────────────────────────── */

function ExamMaterial({
  task,
  focus,
  phase,
}: {
  task: ExamTaskRead;
  focus: Focus | null;
  phase: PhaseInfo["kind"];
}) {
  // Во время ответа на Task 2 — показываем только текущий aim.
  // Во время ответа на Task 3 — только «Question N из M» (без текста).
  const recording = phase === "answer";

  return (
    <article className="min-w-0">
      <header className="border-b border-[var(--color-fg)]/15 pb-5">
        <div className="font-[var(--font-serif)] uppercase tracking-[0.35em] text-xs text-[var(--color-fg-muted)]">
          Task {task.task_number}
        </div>
        <h1 className="mt-2 font-[var(--font-serif)] text-3xl leading-tight text-[var(--color-fg)]">
          {TASK_TYPE_META[task.task_type].title}
        </h1>
      </header>

      {task.task_type === "reading_aloud" && (
        <ReadingAloudView task={task} />
      )}

      {task.task_type === "compose_questions" && (
        <ComposeQuestionsView
          task={task}
          focus={recording ? focus : null}
        />
      )}

      {task.task_type === "interview_answers" && (
        <InterviewAnswersView
          task={task}
          // Во время prep вопросы скрыты; во время записи — только номер.
          focus={focus}
          showQuestions={false}
        />
      )}

      {task.task_type === "photo_based_statement" && (
        <PhotoBasedView task={task} />
      )}
    </article>
  );
}

function ReadingAloudView({ task }: { task: ExamTaskRead }) {
  return (
    <>
      <section className="mt-8">
        <Label>Instructions</Label>
        <InstructionsBlock text={task.prompt_text} />
      </section>
      {task.support_material && (
        <section className="mt-8">
          <Label>Text</Label>
          <div className="mt-3 border border-[var(--color-fg)]/20 p-6 sm:p-8">
            <p className="whitespace-pre-wrap font-[var(--font-serif)] text-lg leading-[1.9] text-[var(--color-fg)]">
              {task.support_material}
            </p>
          </div>
        </section>
      )}
    </>
  );
}

function ComposeQuestionsView({
  task,
  focus,
}: {
  task: ExamTaskRead;
  focus: Focus | null;
}) {
  const aims = parseTask2Aims(task.prompt_text);
  const intro = stripNumberedTail(task.prompt_text);

  // Во время записи — только текущий aim
  if (focus && focus.text) {
    return (
      <section className="mt-10">
        <Label>
          Вопрос {focus.index! + 1} из {focus.total}
        </Label>
        <div className="mt-3 border border-[var(--color-fg)]/25 p-8">
          <p className="font-[var(--font-serif)] text-2xl leading-snug text-[var(--color-fg)]">
            {focus.text}
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="mt-8">
        <Label>Instructions</Label>
        <InstructionsBlock text={intro} />
      </section>
      {task.support_material && (
        <section className="mt-6">
          <Label>Advertisement</Label>
          <div className="mt-3 border border-[var(--color-fg)]/20 p-6">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-[var(--color-fg)]">
              {task.support_material}
            </pre>
          </div>
        </section>
      )}
      {aims.length > 0 && (
        <section className="mt-6">
          <Label>You are to ask about</Label>
          <ol className="mt-3 list-inside list-decimal space-y-1 border border-[var(--color-fg)]/20 p-6 text-[var(--color-fg)]">
            {aims.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function InterviewAnswersView({
  task,
  focus,
}: {
  task: ExamTaskRead;
  focus: Focus | null;
  showQuestions: boolean;
}) {
  // Во время записи показываем только номер текущего вопроса.
  if (focus) {
    return (
      <section className="mt-10">
        <div className="border border-[var(--color-fg)]/25 p-10 text-center">
          <p className="font-[var(--font-serif)] text-4xl text-[var(--color-fg)]">
            Question {focus.index! + 1} of {focus.total}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <Label>Instructions</Label>
      <InstructionsBlock text={task.prompt_text} />
    </section>
  );
}

function PhotoBasedView({ task }: { task: ExamTaskRead }) {
  const photos = [task.image_url, task.image2_url].filter(Boolean) as string[];
  return (
    <>
      <section className="mt-8">
        <Label>Instructions</Label>
        <InstructionsBlock text={task.prompt_text} />
      </section>
      {task.support_material && (
        <section className="mt-6">
          <Label>Problem question</Label>
          <div className="mt-3 border border-[var(--color-fg)]/20 p-5">
            <p className="font-[var(--font-serif)] text-base leading-relaxed text-[var(--color-fg)]">
              {task.support_material}
            </p>
          </div>
        </section>
      )}
      {photos.length > 0 && (
        <section className="mt-6">
          <Label>{photos.length > 1 ? "Photos" : "Photo"}</Label>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {photos.map((src, i) => (
              <figure key={i} className="m-0">
                <div className="relative aspect-[4/3] overflow-hidden border border-[var(--color-fg)]/20 bg-[var(--color-surface-muted)]">
                  <Image
                    src={src.startsWith("http") ? src : `${API_BASE_URL}${src}`}
                    alt={`Photo ${i + 1}`}
                    fill
                    sizes="(max-width: 640px) 100vw, 380px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <figcaption className="mt-2 text-center text-xs uppercase tracking-[0.25em] text-[var(--color-fg-muted)]">
                  Photo {i + 1}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-[var(--font-serif)] uppercase tracking-[0.3em] text-xs text-[var(--color-fg-muted)]">
      {children}
    </div>
  );
}

function InstructionsBlock({ text }: { text: string }) {
  return (
    <div className="mt-3 border-l-2 border-[var(--color-fg)]/30 bg-[var(--color-surface-muted)]/50 py-4 pl-5 pr-4">
      <p className="whitespace-pre-wrap font-[var(--font-serif)] text-[16px] leading-[1.6] text-[var(--color-fg)]">
        {text}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Правая панель: большой таймер, фаза, прогресс.
   ───────────────────────────────────────────────────────────────────── */

function SideTimerPanel({
  taskNumber,
  taskTitle,
  phase,
  focus,
  totalTasks,
  currentIdx,
  recorderError,
  onSkip,
}: {
  taskNumber: 1 | 2 | 3 | 4;
  taskTitle: string;
  phase: PhaseInfo;
  focus: Focus | null;
  totalTasks: number;
  currentIdx: number;
  recorderError: string | null;
  onSkip: () => void;
}) {
  const isRecording = phase.kind === "answer";
  const isPreparing = phase.kind === "preparation";
  const hasProgress = phase.totalSec > 0 && (isPreparing || isRecording);
  const progressPct = hasProgress
    ? Math.min(
        100,
        Math.max(0, ((phase.totalSec - phase.secondsLeft) / phase.totalSec) * 100)
      )
    : 0;

  return (
    <div className="border border-[var(--color-border)] bg-white p-6">
      <div className="font-[var(--font-serif)] uppercase tracking-[0.3em] text-xs text-[var(--color-fg-muted)]">
        Задание {taskNumber} из {totalTasks}
      </div>
      <div className="mt-1 text-sm text-[var(--color-fg)]">{taskTitle}</div>

      <div className="mt-6">
        <div
          className={
            "flex items-center gap-2 text-xs uppercase tracking-[0.3em] " +
            (isRecording
              ? "text-[var(--color-danger)]"
              : "text-[var(--color-fg-muted)]")
          }
        >
          {isRecording && (
            <span
              aria-hidden
              className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-danger)]"
            />
          )}
          {phase.label || "\u00a0"}
        </div>
        <div className="mt-2 font-mono tabular-nums text-5xl text-[var(--color-fg)]">
          {formatMmSs(phase.secondsLeft)}
        </div>
        {focus && (
          <div className="mt-2 text-xs text-[var(--color-fg-muted)]">
            {focus.index! + 1} / {focus.total}
          </div>
        )}

        {/* Тонкий прогресс-бар на всю ширину панели — дублирует верхний
            в шапке, но тут виден рядом с самим таймером. */}
        <div className="mt-4 h-[3px] w-full bg-[var(--color-border)]">
          <div
            className="h-full bg-[#3b82f6] transition-[width] duration-500 ease-linear"
            style={{ width: hasProgress ? `${progressPct}%` : "0%" }}
          />
        </div>

        {/* Кнопка досрочного выхода из фазы. Меняет текст по фазе,
            невидима в idle и во время объявлений. */}
        {(isPreparing || isRecording) && (
          <button
            onClick={onSkip}
            className={
              "mt-5 h-10 w-full border text-sm font-medium transition-colors " +
              (isPreparing
                ? "border-[var(--color-fg)]/30 bg-white text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
                : "border-[var(--color-danger)]/60 bg-white text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]")
            }
          >
            {isPreparing ? "Пропустить подготовку" : "Закончить ответ"}
          </button>
        )}
      </div>

      {recorderError && (
        <p className="mt-6 text-xs text-[var(--color-danger)]">
          {recorderError}
        </p>
      )}

      <div className="mt-6 border-t border-[var(--color-border)] pt-4">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalTasks }).map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 flex-1 " +
                (i < currentIdx
                  ? "bg-[var(--color-fg)]/70"
                  : i === currentIdx
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-border)]")
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Оверлей-объявление («Task 1», «Приготовьтесь 5…», «Start speaking»).
   ───────────────────────────────────────────────────────────────────── */

function AnnouncementOverlay({ overlay }: { overlay: Overlay }) {
  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-30 flex items-center justify-center bg-[var(--color-fg)] px-6 text-center text-white">
      <div>
        {overlay.subtitle && (
          <div className="font-[var(--font-serif)] uppercase tracking-[0.4em] text-xs text-white/60">
            {overlay.subtitle}
          </div>
        )}
        <div className="mt-3 font-[var(--font-serif)] text-4xl sm:text-5xl md:text-6xl">
          {overlay.title}
        </div>
        {overlay.countdown !== undefined && (
          <div className="mt-8 font-mono tabular-nums text-7xl text-[var(--color-accent)]">
            {overlay.countdown}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FinishedScreen — не изменился по сути: плеер + auth-гейт на AI.
   ───────────────────────────────────────────────────────────────────── */

function FinishedScreen({
  variant,
  tasks,
  recordings,
}: {
  variant: ExamVariantRead;
  tasks: ExamTaskRead[];
  recordings: Record<string, Recording>;
}) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const status = useAuth((s) => s.status);
  const decrementPaidChecks = useAuth((s) => s.decrementPaidChecks);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const allRecorded = tasks.every((t) => recordings[t.id]);
  const returnHref = `/variants/${variant.id}`;

  const handleSubmitForAi = async () => {
    if (uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadedCount(0);
    try {
      const firstSubmissionIds: string[] = [];
      for (const t of tasks) {
        const rec = recordings[t.id];
        if (!rec) continue;
        const ext = extensionForMime(rec.mimeType);
        const submission = await uploadSubmission({
          taskId: t.id,
          audio: rec.blob,
          filename: `task-${t.task_number}.${ext}`,
          aiRequested: true,
        });
        firstSubmissionIds.push(submission.id);
        decrementPaidChecks();
        setUploadedCount((c) => c + 1);
      }
      const firstId = firstSubmissionIds[0];
      if (firstId) router.push(`/results/${firstId}`);
      else router.push("/dashboard");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Не удалось отправить записи"
      );
      setUploading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (exportingAll || !allRecorded) return;
    setExportingAll(true);
    setExportError(null);
    try {
      const ordered = tasks
        .map((task) => recordings[task.id])
        .filter((recording): recording is Recording => Boolean(recording));
      const merged = await mergeRecordingsToWav(ordered);
      downloadBlob(merged, buildFullExamFilename(variant.title));
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : "Не удалось собрать одну общую запись."
      );
    } finally {
      setExportingAll(false);
    }
  };

  const needAny = tasks.length;

  return (
    <>
      <ExamHeader
        taskNumber={4}
        taskTitle="Вариант пройден"
        exitHref={`/variants/${variant.id}`}
      />
      <div className="flex-1 bg-white">
        <div className="mx-auto max-w-[720px] px-6 py-16">
          <div className="text-center">
            <div className="font-[var(--font-serif)] uppercase tracking-[0.35em] text-xs text-[var(--color-fg-muted)]">
              Variant complete
            </div>
            <h1 className="mt-3 font-[var(--font-serif)] text-3xl text-[var(--color-fg)]">
              Вариант пройден
            </h1>
            <p className="mt-3 text-[var(--color-fg-muted)]">
              Прослушайте записи — и, если хотите, отправьте их на AI-разбор
              по критериям ФИПИ.
            </p>
          </div>

          <ol className="mt-10 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {tasks.map((t) => {
              const rec = recordings[t.id];
              const meta = TASK_TYPE_META[t.task_type];
              return (
                <li key={t.id} className="flex items-center gap-4 py-4">
                  <div className="flex h-9 w-9 flex-none items-center justify-center border border-[var(--color-border-strong)] font-[var(--font-serif)] text-[var(--color-fg)]">
                    {meta.number}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--color-fg)]">
                      {meta.title}
                    </div>
                    <div className="text-xs text-[var(--color-fg-muted)]">
                      {rec
                        ? `${formatShort(rec.durationSec)} · готово`
                        : "нет записи"}
                    </div>
                  </div>
                  {rec ? (
                    <audio
                      controls
                      src={rec.url}
                      preload="metadata"
                      className="h-8 max-w-[260px]"
                    />
                  ) : (
                    <span className="text-xs text-[var(--color-fg-subtle)]">
                      —
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-6 border border-[var(--color-border)] bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
                  Экспорт записи
                </div>
                <p className="mt-1 text-sm text-[var(--color-fg)]">
                  Сохраните все ответы одним аудиофайлом на устройство.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={!allRecorded || exportingAll}
                className="inline-flex h-11 items-center justify-center bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exportingAll ? "Собираем файл…" : "Скачать всё одним файлом"}
              </button>
            </div>
            {exportError && (
              <p className="mt-3 text-sm text-[var(--color-danger)]">
                {exportError}
              </p>
            )}
          </div>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            {!allRecorded ? (
              <p className="text-sm text-[var(--color-fg-muted)]">
                Не все записи готовы — AI-разбор доступен, когда записаны все
                4 задания.
              </p>
            ) : status === "loading" || status === "idle" ? (
              <p className="text-sm text-[var(--color-fg-muted)]">Загрузка…</p>
            ) : status !== "authed" ? (
              <GuestGate returnHref={returnHref} />
            ) : (user?.paid_checks_available ?? 0) < needAny ? (
              <NotEnoughBalance
                have={user?.paid_checks_available ?? 0}
                need={needAny}
              />
            ) : (
              <AuthedSubmit
                need={needAny}
                uploadedCount={uploadedCount}
                uploading={uploading}
                uploadError={uploadError}
                onSubmit={handleSubmitForAi}
              />
            )}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={`/variants/${variant.id}`}
              className="inline-flex h-11 items-center justify-center border border-[var(--color-fg)]/25 bg-[var(--color-surface)] px-5 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
            >
              Вернуться к варианту
            </Link>
            <Link
              href="/variants"
              className="inline-flex h-11 items-center justify-center border border-[var(--color-fg)]/25 bg-white px-5 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
            >
              Другие варианты
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function GuestGate({ returnHref }: { returnHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
        AI-разбор
      </div>
      <p className="text-sm text-[var(--color-fg)]">
        Чтобы получить разбор по критериям ФИПИ, войдите или создайте аккаунт.
        Первая проверка — бесплатно.
      </p>
      <p className="text-xs text-[var(--color-fg-muted)]">
        После входа записи этого прохождения нужно будет сделать заново — они
        хранятся только в этой вкладке.
      </p>
      <div className="mt-1 flex flex-wrap gap-3">
        <Link
          href={`/login?next=${encodeURIComponent(returnHref)}`}
          className="inline-flex h-11 items-center justify-center bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          Войти
        </Link>
        <Link
          href={`/register?next=${encodeURIComponent(returnHref)}`}
          className="inline-flex h-11 items-center justify-center border border-[var(--color-fg)]/25 bg-white px-5 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-muted)]"
        >
          Создать аккаунт
        </Link>
      </div>
    </div>
  );
}

function NotEnoughBalance({ have, need }: { have: number; need: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
        AI-разбор
      </div>
      <p className="text-sm text-[var(--color-fg)]">
        На балансе {have} проверок, а для разбора варианта нужно {need}
        {". "}
        Пополните, чтобы получить оценку.
      </p>
      <div className="mt-1">
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          Пополнить баланс
        </Link>
      </div>
    </div>
  );
}

function buildFullExamFilename(title: string) {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${normalized || "exam-variant"}-full-recording.wav`;
}

function AuthedSubmit({
  need,
  uploadedCount,
  uploading,
  uploadError,
  onSubmit,
}: {
  need: number;
  uploadedCount: number;
  uploading: boolean;
  uploadError: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs uppercase tracking-[0.3em] text-[var(--color-fg-muted)]">
        AI-разбор
      </div>
      <p className="text-sm text-[var(--color-fg)]">
        Отправим все {need} записи на разбор. С баланса спишется {need}{" "}
        проверки. Результат обычно готов за 1–2 минуты.
      </p>
      {uploadError && (
        <p className="text-sm text-[var(--color-danger)]">{uploadError}</p>
      )}
      {uploading && (
        <p className="text-xs text-[var(--color-fg-muted)]">
          Отправлено {uploadedCount} из {need}…
        </p>
      )}
      <div className="mt-1">
        <button
          onClick={onSubmit}
          disabled={uploading}
          className="inline-flex h-11 min-w-[220px] items-center justify-center bg-[var(--color-accent)] px-5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {uploading ? "Отправляем…" : "Получить AI-разбор"}
        </button>
      </div>
    </div>
  );
}

/* ───────── utils ───────── */

function formatMmSs(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatShort(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s} сек`;
  if (s === 0) return `${m} мин`;
  return `${m} мин ${s} сек`;
}
