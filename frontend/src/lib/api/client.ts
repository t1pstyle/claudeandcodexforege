/**
 * Тонкий fetch-обёрточный клиент к FastAPI.
 *
 * Ключевые решения:
 * - Все типы ответов вытаскиваем из сгенерированного `schema.ts`, вручную ничего
 *   не дублируем. При смене API достаточно перезапустить openapi-typescript.
 * - В браузере токен читаем из localStorage (устанавливаем после логина).
 *   В SSR (getCurrentUser при первом рендере) токен приходит через cookie,
 *   которую пишет наш server action — см. `auth/actions.ts` (будет позже).
 * - Сетевые ошибки и 4xx/5xx превращаем в `ApiError`, у которого есть
 *   `status` и `detail` (из FastAPI), чтобы UI мог отличить 401 от 413 и т.п.
 */
import type { paths } from "./schema";

export type Paths = paths;

// Публичный URL бэка. В dev читаем из .env.local, в проде — из runtime env.
// На сервере (SSR) можно использовать внутренний адрес контейнера;
// на клиенте — только публичный, иначе CORS/доступность сломается.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";

const TOKEN_STORAGE_KEY = "speaking.access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

// FastAPI по умолчанию возвращает ошибки в формате { "detail": "..." }
// или { "detail": [{"loc":[...], "msg":"...", "type":"..."}] } для валидации.
type ApiErrorBody = {
  detail?: string | Array<{ loc: unknown[]; msg: string; type: string }>;
};

export class ApiError extends Error {
  status: number;
  detail: string;
  raw: ApiErrorBody | null;

  constructor(status: number, detail: string, raw: ApiErrorBody | null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.raw = raw;
  }
}

function formatDetail(body: ApiErrorBody | null, fallback: string): string {
  if (!body || body.detail === undefined) return fallback;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    // Валидационная ошибка — собираем человекочитаемо.
    return body.detail
      .map((d) => `${d.loc?.slice(-1)[0] ?? "field"}: ${d.msg}`)
      .join("; ");
  }
  return fallback;
}

interface RequestOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Если true — не добавляем Authorization (для /auth/* ручек). */
  anonymous?: boolean;
  /** Для form-urlencoded (login) передаём Record<string,string>. */
  form?: Record<string, string>;
  /** Для multipart (upload submission) — готовая FormData. */
  formData?: FormData;
  /** Токен, переданный явно (нужен для SSR-фетчей). */
  token?: string | null;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { anonymous, token: explicitToken, form, formData, body, headers = {}, ...rest } = opts;

  // 1. Собираем заголовки.
  const finalHeaders: Record<string, string> = { ...headers };

  if (!anonymous) {
    const token = explicitToken ?? getStoredToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  // 2. Собираем тело запроса.
  let finalBody: BodyInit | undefined;
  if (formData) {
    finalBody = formData; // браузер сам проставит Content-Type с boundary
  } else if (form) {
    finalBody = new URLSearchParams(form).toString();
    finalHeaders["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    finalBody = JSON.stringify(body);
    finalHeaders["Content-Type"] = "application/json";
  }

  // 3. Делаем запрос. Редирект / cache — дефолтный fetch.
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      method: rest.method ?? (finalBody ? "POST" : "GET"),
      headers: finalHeaders,
      body: finalBody,
    });
  } catch {
    // Сетевые ошибки (DNS, оффлайн) — превращаем в 0 / "network".
    throw new ApiError(0, "Сервер недоступен. Проверьте подключение.", null);
  }

  // 4. Для 204/304 просто отдаём undefined.
  if (res.status === 204) return undefined as T;

  // 5. Пытаемся распарсить JSON (но некоторые ручки, типа /audio, отдают blob).
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) {
      throw new ApiError(res.status, res.statusText || "Ошибка запроса", null);
    }
    // Вернём сам Response — вызывающий код сам решит, что с ним делать.
    return res as unknown as T;
  }

  const json = (await res.json()) as ApiErrorBody & Record<string, unknown>;

  if (!res.ok) {
    throw new ApiError(res.status, formatDetail(json, res.statusText || "Ошибка запроса"), json);
  }

  return json as T;
}
