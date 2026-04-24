"""Schemas для API-ответов по Evaluation."""
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class EvaluationRead(BaseModel):
    """
    То, что фронт видит в «Моих тестах» и на странице результата.
    raw_ai_response НЕ отдаём наружу — это для внутренней отладки.
    """
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submission_id: uuid.UUID
    transcript: str
    total_score: int
    max_score: int
    criteria_scores: dict[str, Any]
    feedback: dict[str, Any]
    pronunciation_scores: dict[str, Any] | None
    created_at: datetime
