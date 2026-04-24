"""
Модели ЕГЭ: варианты и задания.

Формат устной части ЕГЭ по английскому (4 задания):
  1. Чтение вслух (~160 слов)                    — prep 90с,  speak 90с
  2. Составление 4 вопросов по объявлению/фото    — prep 90с,  speak 60с
  3. Ответы на 5 вопросов в формате интервью      — prep 90с,  speak 120с
  4. Обоснование выбора по 2 фотографиям          — prep 150с, speak 120с
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TaskType(str, enum.Enum):
    """
    Типы заданий устной части ЕГЭ.
    - reading_aloud          — Задание 1: чтение текста вслух (~160 слов).
    - compose_questions      — Задание 2: 4 вопроса по объявлению/картинке.
    - interview_answers      — Задание 3: ответы на 5 вопросов (интервью).
    - photo_based_statement  — Задание 4: высказывание по 2 фото с обоснованием выбора.
    """
    READING_ALOUD = "reading_aloud"
    COMPOSE_QUESTIONS = "compose_questions"
    INTERVIEW_ANSWERS = "interview_answers"
    PHOTO_BASED_STATEMENT = "photo_based_statement"


class ExamVariant(Base):
    """
    Один вариант ЕГЭ. Содержит 4 задания (ExamTask).
    """
    __tablename__ = "exam_variants"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    # Связь 1-ко-многим: вариант → задания
    tasks: Mapped[list["ExamTask"]] = relationship(
        back_populates="variant",
        order_by="ExamTask.task_number",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<ExamVariant {self.title}>"


class ExamTask(Base):
    """
    Задание внутри варианта.

    prompt_text      — основной текст задания (что читать / вопросы / формулировка).
    support_material — дополнительный материал (например, текст объявления для task 2,
                       5 вопросов для task 3, проблемный вопрос для task 4).
                       Храним отдельно, потому что фронтенду его удобно показывать
                       в разных блоках (основной + "справочный").
    image_url        — картинка (task 2 — объявление, task 4 — фото A).
    image2_url       — вторая картинка (только task 4 — фото B).
    """
    __tablename__ = "exam_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exam_variants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_number: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..4
    task_type: Mapped[TaskType] = mapped_column(
        SQLEnum(TaskType, native_enum=False, length=32),
        nullable=False,
    )

    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    support_material: Mapped[str | None] = mapped_column(Text, nullable=True)

    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image2_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    prep_seconds: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    speak_seconds: Mapped[int] = mapped_column(Integer, default=120, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    variant: Mapped[ExamVariant] = relationship(back_populates="tasks")

    def __repr__(self) -> str:
        return f"<ExamTask #{self.task_number} ({self.task_type.value})>"
