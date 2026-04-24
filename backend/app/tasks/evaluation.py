"""
Celery-задача AI-оценки записи.

ПАЙПЛАЙН:
    1. Берём Submission из БД.
    2. Переводим в status=PROCESSING.
    3. Whisper → transcript (или mock-транскрипт в dev-режиме).
    4. GPT-4o → JSON разбора (или mock-JSON).
    5. Парсим JSON, вытаскиваем total_score/max_score/criteria_scores/feedback.
    6. Создаём Evaluation в БД.
    7. Удаляем аудиофайл с диска и зачищаем submission.audio_path=NULL
       (аудио-файлы мы НЕ храним после обработки — только разбор).
    8. Переводим submission в status=EVALUATED.

В случае любой ошибки — status=FAILED + error_message, аудио НЕ удаляем
(пригодится для ручного разбора).

Mock-режим включается автоматически, если OPENAI_API_KEY пуст или
USE_REAL_AI=false. См. app/evaluation/ai_client.py.
"""
import asyncio
import logging
import uuid
from pathlib import Path

from app.core.config import UPLOADS_DIR, is_real_ai_enabled, settings
from app.crud.evaluation import create_evaluation
from app.crud.submission import get_submission
from app.evaluation.ai_client import (
    evaluate_with_gpt,
    mock_transcribe_for_task,
    transcribe_audio,
)
from app.evaluation.criteria_loader import MAX_SCORE_BY_TASK_TYPE
from app.models.submission import Submission, SubmissionStatus
from app.tasks.celery_app import celery_app
from app.tasks.db import task_session

logger = logging.getLogger(__name__)


async def _run(submission_id: uuid.UUID) -> dict:
    async with task_session() as db:
        submission = await get_submission(db, submission_id)
        if submission is None:
            logger.warning("Submission %s not found", submission_id)
            return {"submission_id": str(submission_id), "status": "not_found"}

        if not submission.audio_path:
            # Аудио уже удалено (например, задача случайно отправлена повторно)
            logger.warning("Submission %s has no audio_path, skipping", submission_id)
            return {"submission_id": str(submission_id), "status": "no_audio"}

        task = submission.task  # благодаря lazy='joined' уже в памяти
        submission.status = SubmissionStatus.PROCESSING
        await db.commit()

        audio_full_path = UPLOADS_DIR / submission.audio_path

        try:
            # ── 1. Транскрипция ─────────────────────────────────────────
            if is_real_ai_enabled():
                transcript = await transcribe_audio(audio_full_path, language="en")
            else:
                # В mock-режиме не читаем файл, возвращаем зашитый транскрипт,
                # специфичный для task_type.
                transcript = await mock_transcribe_for_task(task.task_type)

            logger.info(
                "Transcribed submission %s (%d chars)",
                submission_id, len(transcript),
            )

            # ── 2. GPT-оценка ──────────────────────────────────────────
            parsed, meta = await evaluate_with_gpt(task, transcript)

            # ── 3. Извлекаем итоговый балл ─────────────────────────────
            max_score = MAX_SCORE_BY_TASK_TYPE[task.task_type]
            total_score = int(parsed.get("score", 0))
            # Защитный клэмп: если GPT сглючил и вернул что-то вне диапазона,
            # не даём сохранить мусор.
            total_score = max(0, min(total_score, max_score))

            # ── 4. Считаем стоимость ───────────────────────────────────
            cost_cents = _estimate_cost_cents(
                usage=meta.get("usage", {}),
                audio_seconds=submission.duration_seconds or 0,
                model=meta.get("model", "unknown"),
            )

            # ── 5. Сохраняем Evaluation ────────────────────────────────
            evaluation = await create_evaluation(
                db,
                submission_id=submission.id,
                transcript=transcript,
                total_score=total_score,
                max_score=max_score,
                criteria_scores=_extract_criteria_scores(parsed, task.task_type.value),
                feedback=_extract_feedback(parsed),
                pronunciation_scores=None,  # Azure добавится позже
                raw_ai_response=parsed,
                cost_usd_cents=cost_cents,
                model_version=meta.get("model"),
            )

            # ── 6. Удаляем аудиофайл ───────────────────────────────────
            if audio_full_path.exists():
                audio_full_path.unlink()
            submission.audio_path = None
            submission.audio_mime_type = None
            submission.audio_size_bytes = None

            # ── 7. EVALUATED ───────────────────────────────────────────
            submission.status = SubmissionStatus.EVALUATED
            await db.commit()

            logger.info(
                "Evaluated submission %s: %d/%d (cost ~%d cents)",
                submission_id, total_score, max_score, cost_cents or 0,
            )
            return {
                "submission_id": str(submission_id),
                "evaluation_id": str(evaluation.id),
                "score": total_score,
                "max_score": max_score,
                "status": "evaluated",
            }

        except Exception as e:
            logger.exception("Failed to evaluate submission %s", submission_id)
            submission.status = SubmissionStatus.FAILED
            submission.error_message = str(e)[:1000]
            await db.commit()
            return {
                "submission_id": str(submission_id),
                "status": "failed",
                "error": str(e)[:500],
            }


def _extract_criteria_scores(parsed: dict, task_type_value: str) -> dict:
    """
    Собирает compact-поле criteria_scores в зависимости от типа задания.
    Храним только «баллы по критериям», без длинных feedback-полей
    (они уезжают в отдельное поле feedback).
    """
    if task_type_value == "reading_aloud":
        return {
            "phonetic_score": parsed.get("score", 0),
            "phonetic_errors_estimate": parsed.get("phonetic_errors_estimate"),
            "major_phonetic_errors_estimate": parsed.get("major_phonetic_errors_estimate"),
        }
    if task_type_value == "compose_questions":
        return {
            "total": parsed.get("score", 0),
            "questions": [
                {"index": q.get("index"), "score": q.get("score"),
                 "question_text": q.get("question_text"), "reason": q.get("reason")}
                for q in parsed.get("questions", [])
            ],
        }
    if task_type_value == "interview_answers":
        return {
            "total": parsed.get("score", 0),
            "answers": [
                {"index": a.get("index"), "score": a.get("score"),
                 "student_answer": a.get("student_answer"),
                 "reason": a.get("reason")}
                for a in parsed.get("answers", [])
            ],
        }
    if task_type_value == "photo_based_statement":
        return {
            "total": parsed.get("score", 0),
            "task_solution": parsed.get("task_solution_score"),
            "organization": parsed.get("organization_score"),
            "language": parsed.get("language_score"),
            "aspects": parsed.get("aspects", {}),
            "phrase_count_estimate": parsed.get("phrase_count_estimate"),
            "opening_present": parsed.get("opening_present"),
            "closing_present": parsed.get("closing_present"),
        }
    return {"total": parsed.get("score", 0)}


def _extract_feedback(parsed: dict) -> dict:
    """Общие поля обратной связи — одинаковые для всех task_type."""
    return {
        "summary": parsed.get("summary", ""),
        "strengths": parsed.get("strengths", []),
        "mistakes": parsed.get("mistakes", []),
        "advice": parsed.get("advice", []),
    }


# ---------------------------------------------------------------------------
# ПОДСЧЁТ СТОИМОСТИ
# ---------------------------------------------------------------------------

# Цены актуальны на 2025. Пересчёт — тривиальная смена констант.
_WHISPER_USD_PER_MIN = 0.006
_GPT4O_USD_PER_1M_INPUT = 2.50
_GPT4O_USD_PER_1M_INPUT_CACHED = 1.25
_GPT4O_USD_PER_1M_OUTPUT = 10.00
_GPT4O_MINI_USD_PER_1M_INPUT = 0.15
_GPT4O_MINI_USD_PER_1M_INPUT_CACHED = 0.075
_GPT4O_MINI_USD_PER_1M_OUTPUT = 0.60


def _estimate_cost_cents(*, usage: dict, audio_seconds: float, model: str) -> int:
    """Возвращает приблизительную стоимость в центах (для аналитики маржи)."""
    whisper_cost = (audio_seconds / 60.0) * _WHISPER_USD_PER_MIN

    prompt_tokens = usage.get("prompt_tokens", 0) or 0
    cached_tokens = usage.get("cached_tokens", 0) or 0
    fresh_prompt_tokens = max(0, prompt_tokens - cached_tokens)
    completion_tokens = usage.get("completion_tokens", 0) or 0

    is_mini = "mini" in (model or "").lower()
    if is_mini:
        in_price = _GPT4O_MINI_USD_PER_1M_INPUT
        cached_price = _GPT4O_MINI_USD_PER_1M_INPUT_CACHED
        out_price = _GPT4O_MINI_USD_PER_1M_OUTPUT
    else:
        in_price = _GPT4O_USD_PER_1M_INPUT
        cached_price = _GPT4O_USD_PER_1M_INPUT_CACHED
        out_price = _GPT4O_USD_PER_1M_OUTPUT

    gpt_cost = (
        fresh_prompt_tokens * in_price / 1_000_000
        + cached_tokens * cached_price / 1_000_000
        + completion_tokens * out_price / 1_000_000
    )
    total_usd = whisper_cost + gpt_cost
    return int(round(total_usd * 100))


# ---------------------------------------------------------------------------
# CELERY-ТАСКА
# ---------------------------------------------------------------------------

@celery_app.task(name="app.tasks.evaluation.evaluate_submission", bind=True)
def evaluate_submission(self, submission_id: str) -> dict:
    """Вход: submission_id (строка UUID). Выход: dict (сохраняется в Celery backend)."""
    return asyncio.run(_run(uuid.UUID(submission_id)))
