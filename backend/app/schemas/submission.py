import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.submission import SubmissionStatus
from app.schemas.exam import ExamTaskRead


class SubmissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    task: ExamTaskRead                      # подтянутое задание
    audio_mime_type: str
    audio_size_bytes: int
    duration_seconds: float | None = None
    ai_requested: bool
    status: SubmissionStatus
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
