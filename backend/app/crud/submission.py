import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.submission import Submission, SubmissionStatus


async def create_submission(
    db: AsyncSession,
    *,
    submission_id: uuid.UUID,          # генерим в эндпоинте, чтобы имя файла совпадало
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    audio_path: str,
    audio_mime_type: str,
    audio_size_bytes: int,
    ai_requested: bool,
) -> Submission:
    submission = Submission(
        id=submission_id,
        user_id=user_id,
        task_id=task_id,
        audio_path=audio_path,
        audio_mime_type=audio_mime_type,
        audio_size_bytes=audio_size_bytes,
        ai_requested=ai_requested,
        status=SubmissionStatus.PENDING_AI if ai_requested else SubmissionStatus.UPLOADED,
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return submission


async def list_user_submissions(
    db: AsyncSession,
    user_id: uuid.UUID,
    only_paid: bool = False,
) -> list[Submission]:
    """
    Если only_paid=True, возвращаем только платные записи — именно они
    остаются в личном кабинете пользователя как "мои тесты".
    """
    stmt = select(Submission).where(Submission.user_id == user_id)
    if only_paid:
        stmt = stmt.where(Submission.ai_requested.is_(True))
    stmt = stmt.order_by(Submission.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_submission(
    db: AsyncSession,
    submission_id: uuid.UUID,
) -> Submission | None:
    result = await db.execute(select(Submission).where(Submission.id == submission_id))
    return result.scalar_one_or_none()
