"""
Единая точка импорта моделей.
Alembic смотрит на Base.metadata и видит все модели через эти импорты.
"""
from app.models.evaluation import Evaluation
from app.models.exam import ExamTask, ExamVariant, TaskType
from app.models.submission import Submission, SubmissionStatus
from app.models.user import User

__all__ = [
    "User",
    "ExamVariant",
    "ExamTask",
    "TaskType",
    "Submission",
    "SubmissionStatus",
    "Evaluation",
]
