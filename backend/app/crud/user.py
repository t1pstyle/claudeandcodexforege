"""
CRUD = Create / Read / Update / Delete.
Здесь лежат функции работы с БД для таблицы users.
Отделяем их от эндпоинтов, чтобы логика работы с БД не переплеталась с HTTP.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserCreate


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, payload: UserCreate) -> User:
    """
    Создаёт нового пользователя.
    Пароль хэшируется перед сохранением — в БД попадает только bcrypt-хэш.
    """
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate(
    db: AsyncSession,
    email: str,
    password: str,
) -> User | None:
    """
    Возвращает пользователя, если email+пароль верны.
    Иначе None — НЕ разные ошибки "нет юзера"/"неверный пароль",
    чтобы атакующий не мог узнать, какие email зарегистрированы.
    """
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user
