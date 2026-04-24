from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings

# ----------------------------------------------------------------------
# Хэширование паролей через bcrypt.
# bcrypt специально медленный — один хэш ~100 мс.
# Перебор миллиарда паролей занял бы годы даже на мощном железе.
# ----------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Алгоритм подписи JWT. HS256 — симметричный (один SECRET_KEY).
# Для нашего monolith-сервиса этого достаточно.
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """Превращает plain-пароль в bcrypt-хэш для хранения в БД."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Проверяет, что plain-пароль соответствует хэшу из БД."""
    return pwd_context.verify(plain, hashed)


def create_access_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
) -> str:
    """
    Создаёт JWT-токен.

    subject обычно = user.id. В токене он лежит в поле 'sub'.
    Токен подписан SECRET_KEY — если кто-то его подменит, подпись
    не сойдётся, и API отдаст 401.
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"exp": expire, "sub": str(subject)}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Декодирует JWT. Бросит jwt.InvalidTokenError, если токен
    просрочен, подпись неверная или формат битый.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
