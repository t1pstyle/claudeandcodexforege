/**
 * Высокоуровневый API. Каждый метод — тонкая обёртка над apiFetch
 * с жёсткой типизацией из сгенерированной `schema.ts`.
 *
 * Преимущества по сравнению с вызовами fetch напрямую:
 * - IDE подсказывает поля ответа (меньше опечаток).
 * - При изменении бэкенда (добавили поле → регенерим schema) TS сразу покажет,
 *   где пришло неиспользуемое поле или где старое поле пропало.
 * - Можно вставлять доп. логику (например, `login` пишет токен в localStorage).
 */
import { apiFetch, setStoredToken } from "./client";
import type { paths } from "./schema";
import { API_BASE_URL } from "./client";

// Короткие алиасы на часто используемые типы.
export type UserRead = NonNullable<
  paths["/api/v1/users/me"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type Token =
  paths["/api/v1/auth/login"]["post"]["responses"]["200"]["content"]["application/json"];
export type UserCreate =
  paths["/api/v1/auth/register"]["post"]["requestBody"]["content"]["application/json"];

export type ExamVariantShort =
  paths["/api/v1/variants"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type ExamVariantRead =
  paths["/api/v1/variants/{variant_id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type ExamTaskRead = ExamVariantRead["tasks"][number];

export type SubmissionRead =
  paths["/api/v1/submissions"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type EvaluationRead =
  paths["/api/v1/submissions/{submission_id}/evaluation"]["get"]["responses"]["200"]["content"]["application/json"];
export type SubmissionStatus = SubmissionRead["status"];

export type SubmissionStatusEvent = {
  type: "status";
  submission_id: string;
  task_id: string;
  task_number: 1 | 2 | 3 | 4;
  status: SubmissionStatus;
  ai_requested: boolean;
  error_message: string | null;
  updated_at: string;
  message: string;
  evaluation?: EvaluationRead;
};

export type SubmissionStatusErrorEvent = {
  type: "error";
  code: string;
  message: string;
};

export type SubmissionStatusSocketEvent =
  | SubmissionStatusEvent
  | SubmissionStatusErrorEvent;

// ---------- Auth -----------------------------------------------------------

/**
 * Регистрирует пользователя. НЕ логинит — после успеха отдельно зовём login().
 */
export function register(body: UserCreate) {
  return apiFetch<UserRead>("/api/v1/auth/register", {
    method: "POST",
    anonymous: true,
    body,
  });
}

/**
 * Логинит — OAuth2 password flow. Поля формы: username=email, password=password.
 * При успехе сохраняем access_token в localStorage (используется на клиенте).
 */
export async function login(email: string, password: string): Promise<Token> {
  const token = await apiFetch<Token>("/api/v1/auth/login", {
    method: "POST",
    anonymous: true,
    form: { username: email, password },
  });
  setStoredToken(token.access_token);
  return token;
}

export function logout() {
  setStoredToken(null);
}

/**
 * Возвращает текущего пользователя. Если токен невалиден — бросит ApiError(401).
 * `token` нужен для SSR: на клиенте читаем из localStorage автоматически.
 */
export function getCurrentUser(token?: string | null) {
  return apiFetch<UserRead>("/api/v1/users/me", { token });
}

// ---------- Variants -------------------------------------------------------

export function listVariants(token?: string | null) {
  return apiFetch<ExamVariantShort[]>("/api/v1/variants", { token });
}

export function getVariant(variantId: string, token?: string | null) {
  return apiFetch<ExamVariantRead>(`/api/v1/variants/${variantId}`, { token });
}

// ---------- Submissions ----------------------------------------------------

export function listSubmissions(opts?: { onlyPaid?: boolean; token?: string | null }) {
  const query = opts?.onlyPaid ? "?only_paid=true" : "";
  return apiFetch<SubmissionRead[]>(`/api/v1/submissions${query}`, { token: opts?.token });
}

export function getEvaluation(submissionId: string, token?: string | null) {
  return apiFetch<EvaluationRead>(
    `/api/v1/submissions/${submissionId}/evaluation`,
    { token }
  );
}

export function uploadSubmission(params: {
  taskId: string;
  audio: Blob;
  filename: string;
  aiRequested: boolean;
}) {
  const fd = new FormData();
  fd.append("task_id", params.taskId);
  fd.append("ai_requested", String(params.aiRequested));
  fd.append("audio", params.audio, params.filename);
  return apiFetch<SubmissionRead>("/api/v1/submissions", {
    method: "POST",
    formData: fd,
  });
}

export function audioUrl(submissionId: string) {
  // Абсолютный URL, чтобы <audio src=...> работал даже в SSR.
  // Авторизация через Bearer — браузер сам его не подставит в <audio>;
  // в теге используем через blob: URL, поэтому этот helper пригодится
  // для программного fetch.
  return `/api/v1/submissions/${submissionId}/audio`;
}

export function submissionStatusWsUrl(submissionId: string, token: string) {
  const url = new URL(API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/v1/submissions/${submissionId}/ws`;
  url.searchParams.set("token", token);
  return url.toString();
}
