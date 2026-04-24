"""
Модель Submission — запись ответа пользователя на задание.

ВАЖНО про аудио:
- Аудио-файлы ВСЕГДА временные. Ни одно аудио не хранится долго.
- Бесплатная запись: живёт до 24 ч — даём пользователю скачать,
  потом фоновый Celery-job удаляет файл + саму запись Submission.
- Платная запись: живёт до завершения AI-оценки. После того, как Evaluation
  (шаг 7) сохранён в БД, аудио-файл удаляется, но сама запись Submission
  остаётся (с audio_path=NULL), чтобы связь с Evaluation сохранилась
  и пользователь увидел результат в "Моих тестах".
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SubmissionStatus(str, enum.Enum):
    """
    Жизненный цикл записи:
    - uploaded    — файл загружен, AI не требуется (бесплатный сценарий)
    - pending_ai  — пользователь заказал AI-проверку, задача в очереди Celery
    - processing  — Celery-воркер взял в работу
    - evaluated   — AI отработал, результат (Evaluation) сохранён
    - failed      — что-то сломалось (логируем и показываем пользователю)
    """
    UPLOADED = "uploaded"
    PENDING_AI = "pending_ai"
    PROCESSING = "processing"
    EVALUATED = "evaluated"
    FAILED = "failed"


class Submission(Base):
    """
    Одна загруженная запись = ответ одного пользователя на одно задание.
    Аудио — всегда временное (см. docstring модуля).
    """
    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exam_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Путь к аудио относительно uploads/. Становится NULL после очистки.
    # Например: submissions/{user_id}/{submission_id}.webm
    audio_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    audio_mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audio_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(nullable=True)

    # True, если пользователь заказал AI-проверку. Определяет жизненный цикл:
    # False → запись живёт 24ч и удаляется целиком
    # True  → запись хранится вечно, аудио удаляется после AI
    ai_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    status: Mapped[SubmissionStatus] = mapped_column(
        SQLEnum(SubmissionStatus, native_enum=False, length=32),
        default=SubmissionStatus.UPLOADED,
        nullable=False,
    )

    error_message: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    task = relationship("ExamTask", lazy="joined")

    def __repr__(self) -> str:
        return f"<Submission {self.id} status={self.status.value}>"
