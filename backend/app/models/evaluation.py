"""
Модель Evaluation — результат AI-оценки одной записи (Submission).

Создаётся только для submission c ai_requested=True.
Остаётся в БД навсегда — это как раз то, что пользователь видит в личном
кабинете («Мои платные тесты»). Сам аудиофайл к моменту создания Evaluation
уже удалён, так что вся ценность — в полях ниже.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Evaluation(Base):
    """
    Один Evaluation = одна AI-оценка одной Submission.
    Связь 1-к-1: на одну Submission допускается только одна Evaluation
    (поэтому submission_id помечен уникальным).
    """
    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # Один submission → один evaluation.
    # Если пользователь решит перепроверить — он покупает новую проверку
    # и заливает новый submission. Старый evaluation остаётся в истории.
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    # Что услышала модель (Whisper).
    # Храним как обычный текст — может быть длинным (до ~1500 символов на task 4).
    transcript: Mapped[str] = mapped_column(Text, nullable=False)

    # Общий балл и максимум (зависит от типа задания: 1, 4, 5 или 10).
    # Удобно хранить max_score, чтобы фронтенд показывал «8/10»
    # без необходимости лезть в таблицу типов.
    total_score: Mapped[int] = mapped_column(Integer, nullable=False)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False)

    # Разбалловка по критериям. Структура зависит от типа задания:
    #
    # Task 1 (reading_aloud):
    #   { "phonetic_score": 1, "phonetic_errors": 2, "major_errors": 0 }
    #
    # Task 2 (compose_questions) — 4 вопроса:
    #   { "questions": [
    #       {"score": 1, "question_text": "Where is your school located?"},
    #       {"score": 0, "question_text": "...", "reason": "wrong word order"}
    #     ]
    #   }
    #
    # Task 3 (interview_answers) — 5 ответов:
    #   { "answers": [
    #       {"score": 1, "answer_text": "...", "reason": null},
    #       ...
    #     ]
    #   }
    #
    # Task 4 (photo_based_statement):
    #   { "task_solution": 3,  // РКЗ, 0-4
    #     "organization": 2,   // ОВ, 0-3
    #     "language": 2,       // ЯО, 0-3
    #     "aspects": { "1": "full", "2": "partial", "3": "missing", "4": "full" }
    #   }
    criteria_scores: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Развёрнутая обратная связь для пользователя (то, что он читает на фронте).
    # Структура зависит от task_type, но общая идея:
    #   { "summary": "Короткая сводка 2-3 предложения",
    #     "strengths": ["что получилось хорошо"],
    #     "mistakes": [
    #       {"quote": "цитата из транскрипта",
    #        "issue": "что не так",
    #        "suggestion": "как исправить",
    #        "severity": "major" | "minor"}
    #     ],
    #     "advice": ["персональные рекомендации"] }
    feedback: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Azure Pronunciation Assessment, если был включён. Для task_type != 1 — null.
    # Структура:
    #   { "accuracy_score": 85.2,
    #     "fluency_score": 78.0,
    #     "completeness_score": 98.0,
    #     "pronunciation_score": 82.5,
    #     "words": [{"word": "happiness", "accuracy_score": 92.3}, ...] }
    pronunciation_scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Сырой ответ GPT — нужен для отладки и ручных проверок после жалоб.
    # В будущем, если размер обращений вырастет — можно переместить в S3 / логи.
    raw_ai_response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Сколько стоил вызов в центах (для аналитики маржи).
    # Учитываем Whisper + GPT (+ Azure, когда появится).
    cost_usd_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # В какой модели считали — для A/B-тестов (gpt-4o vs gpt-4o-mini) и для
    # понимания «в каком релизе оценок» был этот разбор.
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    submission = relationship("Submission", backref="evaluation")

    def __repr__(self) -> str:
        return f"<Evaluation {self.id} score={self.total_score}/{self.max_score}>"
