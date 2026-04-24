"""
Загрузчик критериев ЕГЭ в память.

Читает 4 .md файла из app/evaluation/criteria/ ОДИН РАЗ при импорте модуля
(т.е. при старте Celery-воркера или uvicorn) и складывает в dict по TaskType.

Почему именно так:
- Критерии огромные (~3000-6000 токенов на файл). Читать с диска на каждый
  запрос — ненужный I/O.
- Файлы не меняются во время работы. При обновлении критериев — перезапуск
  воркера (отражено в README критериев).
- Заодно это даёт нам прогрев OpenAI prompt cache: текст критериев будет
  байт-в-байт одинаковым между запросами одного task_type.
"""
import logging

from app.core.config import CRITERIA_DIR
from app.models.exam import TaskType

logger = logging.getLogger(__name__)


# Маппинг TaskType → имя файла критериев.
_CRITERIA_FILES: dict[TaskType, str] = {
    TaskType.READING_ALOUD: "task1_reading_aloud.md",
    TaskType.COMPOSE_QUESTIONS: "task2_compose_questions.md",
    TaskType.INTERVIEW_ANSWERS: "task3_interview_answers.md",
    TaskType.PHOTO_BASED_STATEMENT: "task4_photo_based_statement.md",
}


def _load_all_criteria() -> dict[TaskType, str]:
    """
    Читает все 4 файла. Если хотя бы одного нет — падаем громко при старте,
    а не на первом submission в проде.
    """
    result: dict[TaskType, str] = {}
    for task_type, filename in _CRITERIA_FILES.items():
        path = CRITERIA_DIR / filename
        if not path.exists():
            raise FileNotFoundError(
                f"Критерии для {task_type.value} не найдены: {path}. "
                f"Положите файл в app/evaluation/criteria/ и перезапустите воркер."
            )
        content = path.read_text(encoding="utf-8").strip()
        if len(content) < 500:
            # Сигнал что файл подменили на пустой / криво сохранили.
            raise ValueError(
                f"Файл критериев {filename} подозрительно короткий ({len(content)} симв.). "
                f"Ожидаем >= 500 символов."
            )
        result[task_type] = content
        logger.info(
            "Loaded criteria for %s: %d chars", task_type.value, len(content)
        )
    return result


# Загружаем при импорте модуля. Module-level — кэш на весь процесс.
CRITERIA_BY_TASK_TYPE: dict[TaskType, str] = _load_all_criteria()


def get_criteria(task_type: TaskType) -> str:
    """
    Возвращает текст критериев для данного типа задания.
    Бросает KeyError, если тип не поддержан (это баг, а не runtime-ошибка).
    """
    return CRITERIA_BY_TASK_TYPE[task_type]


# Макс. баллы за каждое задание (для подсчёта total_score / max_score).
MAX_SCORE_BY_TASK_TYPE: dict[TaskType, int] = {
    TaskType.READING_ALOUD: 1,
    TaskType.COMPOSE_QUESTIONS: 4,
    TaskType.INTERVIEW_ANSWERS: 5,
    TaskType.PHOTO_BASED_STATEMENT: 10,
}
