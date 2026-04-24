from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """
    Базовый класс для всех ORM-моделей SQLAlchemy 2.0.

    Все модели наследуются от Base. Alembic использует Base.metadata,
    чтобы понять, какие таблицы должны быть в БД, и сгенерировать миграции.
    """
    pass
