"""CRUD для Evaluation — одна запись на один submission."""
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation import Evaluation


async def create_evaluation(
    db: AsyncSession,
    *,
    submission_id: uuid.UUID,
    transcript: str,
    total_score: int,
    max_score: int,
    criteria_scores: dict,
    feedback: dict,
    pronunciation_scores: dict | None = None,
    raw_ai_response: dict | None = None,
    cost_usd_cents: int | None = None,
    model_version: str | None = None,
) -> Evaluation:
    evaluation = Evaluation(
        submission_id=submission_id,
        transcript=transcript,
        total_score=total_score,
        max_score=max_score,
        criteria_scores=criteria_scores,
        feedback=feedback,
        pronunciation_scores=pronunciation_scores,
        raw_ai_response=raw_ai_response,
        cost_usd_cents=cost_usd_cents,
        model_version=model_version,
    )
    db.add(evaluation)
    await db.flush()
    await db.refresh(evaluation)
    return evaluation


async def get_evaluation_by_submission(
    db: AsyncSession, submission_id: uuid.UUID
) -> Optional[Evaluation]:
    stmt = select(Evaluation).where(Evaluation.submission_id == submission_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
