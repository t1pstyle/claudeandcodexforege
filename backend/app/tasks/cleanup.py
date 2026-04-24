"""
Периодическая очистка бесплатных записей.

Бесплатные (ai_requested=False) живут 24 часа: запись + файл на диске.
Платные (ai_requested=True) хранятся вечно (там будет Evaluation из шага 7),
аудио-файл у них удаляется сразу после обработки AI.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, select

from app.core.config import UPLOADS_DIR
from app.models.submission import Submission
from app.tasks.celery_app import celery_app
from app.tasks.db import task_session

logger = logging.getLogger(__name__)

FREE_RETENTION_HOURS = 24


async def _cleanup() -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=FREE_RETENTION_HOURS)
    deleted_records = 0
    deleted_files = 0

    async with task_session() as db:
        result = await db.execute(
            select(Submission).where(
                and_(
                    Submission.ai_requested.is_(False),
                    Submission.created_at < cutoff,
                )
            )
        )
        expired = list(result.scalars().all())

        for sub in expired:
            if sub.audio_path:
                file_path = UPLOADS_DIR / sub.audio_path
                if file_path.exists():
                    file_path.unlink()
                    deleted_files += 1
            await db.delete(sub)
            deleted_records += 1

        await db.commit()

    return {"deleted_records": deleted_records, "deleted_files": deleted_files}


@celery_app.task(name="app.tasks.cleanup.cleanup_expired_free_submissions")
def cleanup_expired_free_submissions() -> dict:
    """Раз в час. Удаляет записи + файлы для бесплатных submissions >24ч."""
    result = asyncio.run(_cleanup())
    logger.info(
        "Cleanup done: records=%s files=%s",
        result["deleted_records"],
        result["deleted_files"],
    )
    return result
