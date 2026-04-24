from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# ----------------------------------------------------------------------
# Асинхронный движок SQLAlchemy.
# - DATABASE_URL использует драйвер asyncpg
#   (postgresql+asyncpg://user:pass@host:port/dbname).
# - echo=True покажет все SQL-запросы в логах — удобно для отладки,
#   но шумно. Оставляем False.
# - pool_pre_ping=True: SQLAlchemy проверяет, что соединение живое,
#   перед выдачей из пула (спасает от "server closed connection" после
#   перезапуска PostgreSQL).
# ----------------------------------------------------------------------
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

# Фабрика сессий. Каждый HTTP-запрос получит свою изолированную сессию.
# expire_on_commit=False — после .commit() объекты остаются пригодны
# к использованию (иначе FastAPI-ответ упадёт при обращении к полям).
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI-зависимость. Выдаёт async-сессию для работы с БД и
    автоматически закрывает её после окончания запроса.

    Использование:
        from fastapi import Depends
        from sqlalchemy.ext.asyncio import AsyncSession
        from app.db.session import get_db

        @app.get("/users")
        async def list_users(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(User))
            return result.scalars().all()
    """
    async with AsyncSessionLocal() as session:
        yield session
