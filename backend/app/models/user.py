import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """
    Пользователь SaaS.

    Поля:
    - id — UUID (безопаснее последовательных ID: нельзя угадать следующий).
    - email — уникальный, индексированный; логин пользователя.
    - hashed_password — bcrypt-хэш (чистый пароль НИКОГДА не храним).
    - full_name — опциональное имя пользователя.
    - is_active — мягкий запрет доступа без удаления записи.
    - is_superuser — права админа (доступ к /admin в будущем).
    - paid_checks_available — сколько платных AI-проверок осталось.
    - created_at / updated_at — автоматические таймстампы (PostgreSQL NOW()).
    """
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Оставшиеся платные проверки. Пополняется при успешной оплате,
    # уменьшается при каждом вызове AI-оценки.
    paid_checks_available: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<User {self.email}>"
