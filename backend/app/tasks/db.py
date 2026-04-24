"""
Отдельный фабричный helper для Celery-задач.

ПРОБЛЕМА: глобальный AsyncSessionLocal из app.db.session держит пул asyncpg,
привязанный к event-loop, в котором он был впервые использован. Celery-воркер
(worker_max_tasks_per_child=100) в одном child-процессе вызывает asyncio.run()
многократно — каждый раз это НОВЫЙ loop. Старый пул остаётся прикреплён к
закрытому loop → ошибка "got Future attached to a different loop".

РЕШЕНИЕ: в каждой задаче создаём свежий engine с NullPool (без переиспользования
соединений), в конце dispose(). Медленнее на ~10 мс, но надёжно и без сюрпризов.
"""
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


@asynccontextmanager
async def task_session() -> AsyncSession:
    """
    Use:
        async with task_session() as db:
            ...
    """
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with Session() as session:
            yield session
    finally:
        await engine.dispose()
