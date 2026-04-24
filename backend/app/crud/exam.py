import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.exam import ExamTask, ExamVariant


async def list_published_variants(db: AsyncSession) -> list[ExamVariant]:
    result = await db.execute(
        select(ExamVariant)
        .where(ExamVariant.is_published.is_(True))
        .order_by(ExamVariant.created_at.desc())
    )
    return list(result.scalars().all())


async def get_variant_with_tasks(db: AsyncSession, variant_id: uuid.UUID) -> ExamVariant | None:
    """
    Загружает вариант с заданиями одним запросом (selectinload → 2 SELECT'а
    вместо N+1).
    """
    result = await db.execute(
        select(ExamVariant)
        .where(ExamVariant.id == variant_id)
        .options(selectinload(ExamVariant.tasks))
    )
    return result.scalar_one_or_none()


async def get_task(db: AsyncSession, task_id: uuid.UUID) -> ExamTask | None:
    result = await db.execute(select(ExamTask).where(ExamTask.id == task_id))
    return result.scalar_one_or_none()
