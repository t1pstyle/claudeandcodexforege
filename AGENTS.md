# Speaking Trainer — проектный контекст для Codex

Этот файл читается в каждую новую сессию. Здесь — только то, что нужно знать **до** первого tool-вызова. Детали реализации живут в коде и в комментариях к файлам.

## Что это

Тренажёр устной части ЕГЭ по английскому (4 задания). Пользователь проходит вариант целиком, голос записывается в браузере, отправляется на бэкенд, там Whisper + Azure Pronunciation Assessment + GPT дают разбор по официальным критериям ФИПИ.

Бизнес-модель: первая AI-проверка бесплатно, далее пакеты — 1 шт × 99₽ или 5 шт × 399₽ через СБП/ЮKassa.

## Стек

- **Backend:** Python 3.12, FastAPI, SQLModel, PostgreSQL, Redis + Celery, OpenAI (Whisper + GPT-4o), Azure Speech (Pronunciation Assessment)
- **Frontend:** Next.js 15.5 App Router (Turbopack), React 19, TypeScript strict, Tailwind CSS v4 (CSS-first `@theme`), Zustand (auth), react-hook-form + zod, openapi-typescript codegen
- **Инфра:** Docker Compose на VPS, позже — Cloudflare

## Раскладка репо

```
backend/           FastAPI app (app/main.py, app/api/v1/*, app/models, app/services/ai)
frontend/          Next.js app
  src/app/         маршруты (App Router)
  src/components/  UI + layout + exam + auth
  src/lib/         api/ (client, endpoints, schema), auth/store, task-meta
```

## Фронтовые конвенции (важно)

- **Серверные компоненты по умолчанию.** `"use client"` только там, где нужен state/effects/browser API.
- **Типы API генерируются**: `frontend/src/lib/api/schema.ts` — автоген из OpenAPI, не править руками. Команда: `npx openapi-typescript http://localhost:8000/api/v1/openapi.json -o src/lib/api/schema.ts`.
- **Все вызовы бэкенда** — через `src/lib/api/endpoints.ts`, не через голый fetch.
- **Tailwind v4** — токены в `src/app/globals.css` под `@theme`. Классы цветов/радиусов: `bg-[var(--color-surface)]`, `rounded-[var(--radius-md)]` и т.п. (v4 не генерит arbitrary values из токенов автоматически — используем CSS-переменные).
- **Палитра:** тёплые нейтрали — `#FAF9F6` фон, `#1F1E1C` текст, `#C96442` терракот-акцент. Шрифты: Inter (UI) + Source Serif 4 (заголовки, экзамен-метки).
- **Zustand-селекторы — примитивы, а не объекты.** `useAuth((s) => s.user)`, НЕ `useAuth((s) => ({ user: s.user, logout: s.logout }))` — последнее создаёт новый объект на каждый рендер и даёт Maximum update depth.
- **`suppressHydrationWarning`** стоит на `<html>` и `<body>` — это не баг, это из-за Dark Reader / других расширений, модифицирующих DOM до гидратации.

## UX-архитектура

### Режим сайта vs режим экзамена
`AppShell` (`src/components/layout/app-shell.tsx`, client) смотрит `usePathname()` и скрывает хедер/футер на роутах экзамена:
```ts
const isExamMode = /^\/variants\/[^/]+\/exam(\/|$)/.test(pathname);
```
Если появятся новые экзамен-маршруты — дополнять регекс здесь.

### Варианты проходятся ЦЕЛИКОМ
Важно: никаких отдельных маршрутов типа `/tasks/[id]`. Только:
- `/variants` — каталог (SSR, revalidate=60)
- `/variants/[id]` — обзор варианта, одна CTA «Начать вариант»
- `/variants/[id]/exam` — `ExamRunner` (client state machine), без сайтового хрома

Внутри `ExamRunner` пользователь идёт последовательно: задание 1 → 2 → 3 → 4, без возврата.

### **Бизнес-правило: auth vs практика (КРИТИЧЕСКОЕ)**

- **Проходить вариант (записывать, слушать себя) можно БЕЗ аккаунта.** Это тренировка, не тратит ресурсов.
- **Запрос AI-разбора требует аккаунта.** Даже первую бесплатную проверку — иначе некуда привязать баланс и результат.
- На `FinishedScreen` CTA «Получить AI-разбор»:
  - гость → приглашение войти/зарегистрироваться, записи живут в памяти клиента до этого момента;
  - залогинен + `paid_checks_available > 0` → отправка submissions с `ai_requested=true`;
  - залогинен + баланс = 0 → перенаправление на оплату.
- Страница `/variants/[id]/exam` **не** обёрнута в `RequireAuth` — это осознанно.

### Дизайн экзамен-режима
Строгий, минималистичный: тёмная h-12 шапка `#1f1e1c`, узкая колонка 760px, серифный заголовок «TASK N», бордеры вместо теней, никаких акцент-цветов кроме `[var(--color-accent)]` на главном CTA. Ориентир — официальный тестовый режим ФИПИ / SvetlanaEnglish, а не яркий edutainment.

## Модели (сокращённо)

- `UserRead`: `id`, `email`, `full_name?`, `paid_checks_available: number`, `is_active`, ...
- `ExamVariantRead`: `id`, `title`, `description?`, `tasks: ExamTaskRead[]`
- `ExamTaskRead`: `id`, `task_number (1|2|3|4)`, `task_type`, `prep_seconds`, `speak_seconds`, + специфичные поля (`material_text`, `photos[]`, `prompt_lines[]`, ...)
- `SubmissionRead`: `id`, `task_id`, `status: 'pending_ai'|'processing'|'done'|'failed'|'expired'`, `ai_requested`, `created_at`, ...
- `EvaluationRead`: критерии по task_type, `total_score`, `feedback`, `transcript?`, ...

## Запуск локально

Порядок важен: сначала инфраструктура, потом бэк, потом фронт.

```bash
# 1. Postgres + Redis в Docker (из корня репо). Берёт env из ./.env
#    (POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB). Docker Desktop должен быть запущен.
docker compose up -d

# 2. backend  (venv называется именно `venv`, не `.venv`)
cd backend && source venv/bin/activate && uvicorn app.main:app --reload
# в другом терминале — Celery-воркер для AI-пайплайна
cd backend && source venv/bin/activate && celery -A app.worker worker -l info

# 3. frontend
cd frontend && npm run dev    # http://localhost:3000
```

`.env.local` у фронта: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.
`.env` в корне: `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` — для docker-compose.

Быстрая диагностика: `curl http://localhost:8000/api/v1/variants` → должен отдать JSON-массив. Если 500 и в логах `ConnectionRefusedError` — Postgres не поднят, зови `docker compose up -d`.

## Роадмап

- ✅ Step 1–7: backend (модели, auth, variants, submissions, Celery, Whisper/Azure/GPT, критерии)
- ✅ Step 8: frontend базовый — лендинг, auth, каталог, обзор варианта, whole-variant exam flow (пустой рекордер-плейсхолдер)
- 🟡 **Step 9: MediaRecorder в ExamRunner** — реальные таймеры prep/speak, запись, плеер, auth-гейт на AI-разборе ← **СЕЙЧАС**
- Step 10: WebSocket real-time прогресс обработки submission
- Step 11: ЮKassa/СБП платежи
- Step 12: Docker Compose деплой на VPS

## Чего НЕ делать

- Не создавать `*.md` и `README` без явной просьбы.
- Не делать per-task маршруты (`/tasks/[id]`) — в прошлом были, пользователь попросил убрать. Вариант только целиком.
- Не амендить чужие коммиты, не делать `git push --force`, не пропускать хуки.
- Не трогать `src/lib/api/schema.ts` руками — перегенерировать.
- Не добавлять auth-guard на `/variants/**` — публичное.
- Не менять бизнес-правила без спроса (99₽/399₽, первая бесплатно, 24ч TTL на не-AI записи).
