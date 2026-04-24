"""
Celery-приложение. Брокер и backend — Redis.

Запуск воркера (в отдельном терминале, venv активирован):
    celery -A app.tasks.celery_app worker --loglevel=info

Запуск beat (планировщик периодических задач):
    celery -A app.tasks.celery_app beat --loglevel=info

Или всё вместе одним процессом (удобно в dev):
    celery -A app.tasks.celery_app worker --beat --loglevel=info
"""
from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "speaker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.tasks.evaluation",
        "app.tasks.cleanup",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Воркер помечает задачу как started, когда берёт её в работу
    # (нужно, чтобы в UI показывать "Processing…").
    task_track_started=True,

    # acks_late=True: задача считается выполненной только ПОСЛЕ return'а,
    # а не сразу после взятия. Если воркер упадёт — Redis вернёт задачу в очередь.
    task_acks_late=True,

    # Один AI-вызов длинный (~30 сек). Prefetch=1 гарантирует, что один воркер
    # не хватает сразу 4 задачи, пока тянет первую. Задачи распределяются
    # между воркерами более равномерно.
    worker_prefetch_multiplier=1,

    # Максимум задач на одном воркере до рестарта — защищает от утечек памяти.
    worker_max_tasks_per_child=100,
)


# ---------------------------------------------------------------
# Периодические задачи (beat).
# ---------------------------------------------------------------
celery_app.conf.beat_schedule = {
    "cleanup-expired-free-submissions": {
        "task": "app.tasks.cleanup.cleanup_expired_free_submissions",
        "schedule": crontab(minute="15"),  # каждый час в :15
    },
}
