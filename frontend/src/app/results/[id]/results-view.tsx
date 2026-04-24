"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RequireAuth } from "@/components/auth/require-auth";
import { ApiError, getStoredToken } from "@/lib/api/client";
import {
  getEvaluation,
  submissionStatusWsUrl,
  type EvaluationRead,
  type SubmissionStatus,
  type SubmissionStatusSocketEvent,
} from "@/lib/api/endpoints";

/**
 * Страница результата. Фетчим /submissions/{id}/evaluation.
 * Сценарии:
 *  - 200: разбор готов — показываем.
 *  - 202: ещё обрабатывается — опрашиваем каждые 4 секунды.
 *  - 403: чужой submission — "нет доступа".
 *  - 404: нет submission.
 *  - 409: failed — показываем error_message.
 *  - 410: ai_requested=false — "разбор не заказывался".
 */
export function ResultsView({ submissionId }: { submissionId: string }) {
  return (
    <RequireAuth>
      <Container className="py-10">
        <ResultsContent submissionId={submissionId} />
      </Container>
    </RequireAuth>
  );
}

type State =
  | { kind: "loading" }
  | {
      kind: "pending";
      message: string;
      status: PendingStatus;
      taskNumber?: number;
    }
  | { kind: "ready"; evaluation: EvaluationRead }
  | { kind: "error"; title: string; message: string };

type ConnectionMode = "connecting" | "live" | "fallback";
type PendingStatus = Extract<SubmissionStatus, "uploaded" | "pending_ai" | "processing">;

function ResultsContent({ submissionId }: { submissionId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("connecting");

  const fetchOnce = useCallback(
    async (connection: ConnectionMode): Promise<"done" | "retry" | "stop"> => {
      try {
        const evaluation = await getEvaluation(submissionId);
        setState({ kind: "ready", evaluation });
        return "done";
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 202) {
            setConnectionMode(connection);
            setState({
              kind: "pending",
              message: err.detail,
              status: extractPendingStatus(err.detail),
            });
            return "retry";
          }
          if (err.status === 403)
            setState({ kind: "error", title: "Нет доступа", message: "Это чужая запись." });
          else if (err.status === 404)
            setState({ kind: "error", title: "Не найдено", message: "Запись не существует." });
          else if (err.status === 409)
            setState({
              kind: "error",
              title: "Разбор не удался",
              message: err.detail || "AI не смог обработать запись.",
            });
          else if (err.status === 410)
            setState({
              kind: "error",
              title: "Разбор не заказан",
              message: "Для этой записи AI-разбор не оплачивался.",
            });
          else
            setState({ kind: "error", title: "Ошибка", message: err.detail });
        } else {
          setState({
            kind: "error",
            title: "Ошибка сети",
            message: err instanceof Error ? err.message : "Неизвестная ошибка",
          });
        }
        return "stop";
      }
    },
    [submissionId]
  );

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let fallbackStarted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const stopPolling = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const runPolling = async () => {
      const result = await fetchOnce("fallback");
      if (cancelled || settled) return;
      if (result === "retry") {
        timer = setTimeout(runPolling, 4000);
        return;
      }
      settled = true;
    };

    const startFallback = () => {
      if (cancelled || settled || fallbackStarted) return;
      fallbackStarted = true;
      setConnectionMode("fallback");
      stopPolling();
      if (socket) socket.close();
      void runPolling();
    };

    const token = getStoredToken();
    if (!token) {
      startFallback();
      return () => {
        cancelled = true;
        stopPolling();
      };
    }

    setConnectionMode("connecting");
    socket = new WebSocket(submissionStatusWsUrl(submissionId, token));
    socket.onopen = () => {
      if (cancelled || settled) return;
      setConnectionMode("live");
    };
    socket.onmessage = (event) => {
      if (cancelled || settled) return;

      let payload: SubmissionStatusSocketEvent;
      try {
        payload = JSON.parse(event.data) as SubmissionStatusSocketEvent;
      } catch {
        startFallback();
        return;
      }

      if (payload.type === "error") {
        settled = true;
        setState({
          kind: "error",
          title: "Ошибка",
          message: payload.message,
        });
        return;
      }

      if (payload.status === "failed") {
        settled = true;
        setState({
          kind: "error",
          title: "Разбор не удался",
          message: payload.error_message || payload.message,
        });
        return;
      }

      if (payload.status === "evaluated") {
        if (payload.evaluation) {
          settled = true;
          setState({ kind: "ready", evaluation: payload.evaluation });
          return;
        }
        startFallback();
        return;
      }

      setConnectionMode("live");
      setState({
        kind: "pending",
        message: payload.message,
        status: toPendingStatus(payload.status),
        taskNumber: payload.task_number,
      });
    };
    socket.onerror = () => {
      startFallback();
    };
    socket.onclose = () => {
      if (cancelled || settled) return;
      startFallback();
    };

    return () => {
      cancelled = true;
      stopPolling();
      if (socket) socket.close();
    };
  }, [fetchOnce, submissionId]);

  if (state.kind === "loading") {
    return <div className="text-sm text-[var(--color-fg-muted)]">Загружаем…</div>;
  }

  if (state.kind === "pending") {
    return <PendingEvaluationCard pending={state} connectionMode={connectionMode} />;
  }

  if (state.kind === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{state.title}</CardTitle>
          <p className="text-sm text-[var(--color-fg-muted)]">{state.message}</p>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Вернуться в кабинет
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <EvaluationView e={state.evaluation} />;
}

function PendingEvaluationCard({
  pending,
  connectionMode,
}: {
  pending: Extract<State, { kind: "pending" }>;
  connectionMode: ConnectionMode;
}) {
  const steps = getPendingSteps(pending.status);
  const liveBadge =
    connectionMode === "live"
      ? { label: "Live", variant: "success" as const }
      : connectionMode === "connecting"
        ? { label: "Подключаемся", variant: "accent" as const }
        : { label: "Резервный режим", variant: "warning" as const };

  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-accent-hover)] to-[var(--color-fg)]" />
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={liveBadge.variant}>{liveBadge.label}</Badge>
          {pending.taskNumber && <Badge>Задание {pending.taskNumber}</Badge>}
        </div>
        <CardTitle>AI готовит разбор</CardTitle>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Обычно это занимает 20–40 секунд. Страница обновится сама, как только результат будет
          готов.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.label}
              className={
                "rounded-[var(--radius-md)] border p-4 transition-colors " +
                (step.state === "done"
                  ? "border-[var(--color-success)]/30 bg-[var(--color-success-soft)]"
                  : step.state === "current"
                    ? "border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-muted)]/60")
              }
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-[var(--color-fg)]">{step.label}</div>
                <span
                  aria-hidden
                  className={
                    "h-2.5 w-2.5 rounded-full " +
                    (step.state === "done"
                      ? "bg-[var(--color-success)]"
                      : step.state === "current"
                        ? "animate-pulse bg-[var(--color-accent)]"
                        : "bg-[var(--color-border-strong)]/50")
                  }
                />
              </div>
              <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{step.description}</p>
            </div>
          ))}
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Текущий статус
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-fg)]">
            {pending.message}
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm text-[var(--color-fg-muted)]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
          Проверка идёт в фоне, можно оставить эту вкладку открытой.
        </div>
      </CardContent>
    </Card>
  );
}

function EvaluationView({ e }: { e: EvaluationRead }) {
  const fb = e.feedback as Feedback;
  const cs = e.criteria_scores as Record<string, unknown>;

  return (
    <>
      <Link href="/dashboard" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
        ← Кабинет
      </Link>

      {/* ── Score hero ───────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-sm uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Итоговая оценка
          </div>
          <div className="mt-1 flex items-baseline gap-3 font-[var(--font-serif)]">
            <span className="text-6xl text-[var(--color-fg)]">{e.total_score}</span>
            <span className="text-2xl text-[var(--color-fg-subtle)]">/ {e.max_score}</span>
          </div>
        </div>
        <div className="text-sm text-[var(--color-fg-muted)]">
          Разобрано{" "}
          {new Date(e.created_at).toLocaleString("ru-RU", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {fb?.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Общий вывод</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[15px] leading-relaxed text-[var(--color-fg)]">{fb.summary}</p>
              </CardContent>
            </Card>
          )}

          {Array.isArray(fb?.strengths) && fb.strengths.length > 0 && (
            <FeedbackList
              title="Что получилось"
              items={fb.strengths}
              dotClass="bg-[var(--color-success)]"
            />
          )}
          {Array.isArray(fb?.mistakes) && fb.mistakes.length > 0 && (
            <FeedbackList
              title="Что можно улучшить"
              items={fb.mistakes}
              dotClass="bg-[var(--color-danger)]"
            />
          )}
          {Array.isArray(fb?.advice) && fb.advice.length > 0 && (
            <FeedbackList
              title="Советы"
              items={fb.advice}
              dotClass="bg-[var(--color-accent)]"
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Транскрипт речи</CardTitle>
              <p className="text-sm text-[var(--color-fg-muted)]">
                Распознано автоматически моделью Whisper.
              </p>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-4 text-[15px] leading-relaxed font-[var(--font-serif)] text-[var(--color-fg)]">
                {e.transcript || "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>По критериям</CardTitle>
            </CardHeader>
            <CardContent>
              <CriteriaBreakdown data={cs} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

type Feedback = {
  summary?: string;
  strengths?: string[];
  mistakes?: string[];
  advice?: string[];
};

function FeedbackList({
  title,
  items,
  dotClass,
}: {
  title: string;
  items: string[];
  dotClass: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2.5 text-[15px] leading-relaxed text-[var(--color-fg)]">
          {items.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className={`mt-2 h-1.5 w-1.5 flex-none rounded-full ${dotClass}`}
              />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * criteria_scores имеет разную структуру по task_type.
 * Отрисовываем обобщённо: если нашли знакомые поля — покажем красиво,
 * иначе свалим в пары ключ/значение.
 */
function CriteriaBreakdown({ data }: { data: Record<string, unknown> }) {
  // photo_based_statement: {task_solution, organization, language, aspects, ...}
  if ("task_solution" in data && "organization" in data && "language" in data) {
    return (
      <dl className="space-y-3 text-sm">
        <ScoreRow label="Решение задачи" value={data.task_solution} max={4} />
        <ScoreRow label="Организация" value={data.organization} max={3} />
        <ScoreRow label="Язык" value={data.language} max={3} />
      </dl>
    );
  }
  // compose_questions / interview_answers: {total, questions:[...] / answers:[...]}
  if (Array.isArray((data as { questions?: unknown }).questions)) {
    return <ItemsList items={data.questions as Item[]} label="Вопрос" />;
  }
  if (Array.isArray((data as { answers?: unknown }).answers)) {
    return <ItemsList items={data.answers as Item[]} label="Ответ" />;
  }
  // reading_aloud / fallback
  return (
    <dl className="space-y-2 text-sm">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2">
          <dt className="text-[var(--color-fg-muted)]">{humanize(k)}</dt>
          <dd className="font-medium text-[var(--color-fg)]">{String(v ?? "—")}</dd>
        </div>
      ))}
    </dl>
  );
}

type Item = { index?: number; score?: number; reason?: string };

function ItemsList({ items, label }: { items: Item[]; label: string }) {
  return (
    <ul className="space-y-3 text-sm">
      {items.map((it, i) => (
        <li key={i} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-fg-muted)]">
              {label} {it.index ?? i + 1}
            </span>
            <Badge variant={it.score ? "success" : "danger"}>{it.score ?? 0}</Badge>
          </div>
          {it.reason && <div className="text-[var(--color-fg-subtle)]">{it.reason}</div>}
        </li>
      ))}
    </ul>
  );
}

function ScoreRow({ label, value, max }: { label: string; value: unknown; max: number }) {
  const v = typeof value === "number" ? value : Number(value ?? 0);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-[var(--color-fg-muted)]">{label}</dt>
      <dd className="font-medium text-[var(--color-fg)]">
        {v} <span className="text-[var(--color-fg-subtle)]">/ {max}</span>
      </dd>
    </div>
  );
}

function humanize(key: string): string {
  const map: Record<string, string> = {
    total: "Всего",
    phonetic_score: "Фонетика",
    phonetic_errors_estimate: "Негрубых ошибок",
    major_phonetic_errors_estimate: "Грубых ошибок",
  };
  return map[key] ?? key.replaceAll("_", " ");
}

function extractPendingStatus(detail: string): PendingStatus {
  if (detail.includes("status=processing")) return "processing";
  if (detail.includes("status=uploaded")) return "uploaded";
  return "pending_ai";
}

function toPendingStatus(status: SubmissionStatus): PendingStatus {
  if (status === "processing") return "processing";
  if (status === "uploaded") return "uploaded";
  return "pending_ai";
}

function getPendingSteps(status: PendingStatus) {
  const currentIndex =
    status === "uploaded" || status === "pending_ai"
      ? 0
      : status === "processing"
        ? 1
        : 2;

  return [
    {
      label: "Запись в очереди",
      description: "Файл получен и ждёт запуска AI-пайплайна.",
      state: currentIndex > 0 ? "done" : "current",
    },
    {
      label: "Проверка ответа",
      description: "Whisper и GPT обрабатывают ответ по критериям ФИПИ.",
      state: currentIndex > 1 ? "done" : currentIndex === 1 ? "current" : "todo",
    },
    {
      label: "Разбор появится здесь",
      description: "Как только расчёт завершится, карточка заменится результатом.",
      state: currentIndex === 2 ? "current" : "todo",
    },
  ] as const;
}
