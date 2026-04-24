import Image from "next/image";
import { API_BASE_URL } from "@/lib/api/client";
import type { ExamTaskRead } from "@/lib/api/endpoints";
import { TASK_TYPE_META } from "@/lib/task-meta";

/**
 * Общий рендер тела одного задания в «экзаменационном» стиле:
 * - строгие бордерные блоки без скруглений и теней;
 * - серифная типографика;
 * - английские инструкции отдельно от материала;
 * - фотографии с подписями "Photo 1/2".
 *
 * Используется и на обзорной странице задания (preview), и в режиме теста,
 * где рядом добавляется блок диктофона.
 */
export function TaskBody({ task }: { task: ExamTaskRead }) {
  const meta = TASK_TYPE_META[task.task_type];

  return (
    <article className="mx-auto max-w-[760px] px-6 py-12 sm:py-14">
      {/* ── "TASK N" заголовок (как в печатной версии ФИПИ) ───── */}
      <header className="border-b border-[var(--color-fg)]/15 pb-6">
        <div className="font-[var(--font-serif)] text-[var(--color-fg-muted)] uppercase tracking-[0.35em] text-xs">
          Task {meta.number}
        </div>
        <h1 className="mt-2 font-[var(--font-serif)] text-3xl leading-tight text-[var(--color-fg)]">
          {meta.title}
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-fg-muted)]">
          <span>Подготовка: {formatTime(task.prep_seconds)}</span>
          <span>Ответ: {formatTime(task.speak_seconds)}</span>
          <span>Максимум: {meta.maxScore} балл{wordFormScore(meta.maxScore)}</span>
        </div>
      </header>

      {/* ── Инструкции (английский prompt_text) ────────────────── */}
      <section className="mt-10">
        <InstructionsBlock text={task.prompt_text} />
      </section>

      {/* ── Материал задания ──────────────────────────────────── */}
      {task.support_material && (
        <section className="mt-8">
          <SectionLabel>
            {task.task_type === "reading_aloud"
              ? "Text"
              : task.task_type === "compose_questions"
              ? "Advertisement"
              : "Material"}
          </SectionLabel>
          <MaterialBlock text={task.support_material} variant={task.task_type} />
        </section>
      )}

      {/* ── Фотографии (Task 4) ───────────────────────────────── */}
      {(task.image_url || task.image2_url) && (
        <section className="mt-8">
          <SectionLabel>
            {task.image_url && task.image2_url ? "Photos" : "Photo"}
          </SectionLabel>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[task.image_url, task.image2_url].map((src, i) =>
              src ? (
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
              ) : null
            )}
          </div>
        </section>
      )}
    </article>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-[var(--font-serif)] text-[var(--color-fg-muted)] uppercase tracking-[0.3em] text-xs">
      {children}
    </div>
  );
}

function InstructionsBlock({ text }: { text: string }) {
  return (
    <div className="border-l-2 border-[var(--color-fg)]/30 bg-[var(--color-surface-muted)]/50 py-5 pl-6 pr-5">
      <p className="whitespace-pre-wrap font-[var(--font-serif)] text-[17px] leading-[1.65] text-[var(--color-fg)]">
        {text}
      </p>
    </div>
  );
}

function MaterialBlock({
  text,
  variant,
}: {
  text: string;
  variant: ExamTaskRead["task_type"];
}) {
  if (variant === "reading_aloud") {
    return (
      <div className="mt-4 border border-[var(--color-fg)]/20 p-6 sm:p-8">
        <p className="whitespace-pre-wrap font-[var(--font-serif)] text-lg leading-[1.9] text-[var(--color-fg)]">
          {text}
        </p>
      </div>
    );
  }
  if (variant === "compose_questions") {
    return (
      <div className="mt-4 border border-[var(--color-fg)]/20 p-6">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-[var(--color-fg)]">
          {text}
        </pre>
      </div>
    );
  }
  return (
    <div className="mt-4 border border-[var(--color-fg)]/20 p-6">
      <p className="whitespace-pre-wrap font-[var(--font-serif)] text-base leading-relaxed text-[var(--color-fg)]">
        {text}
      </p>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s} сек`;
  if (s === 0) return `${m} мин`;
  return `${m} мин ${s} сек`;
}

function wordFormScore(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "ов";
  if (mod10 === 1) return "";
  if (mod10 >= 2 && mod10 <= 4) return "а";
  return "ов";
}
