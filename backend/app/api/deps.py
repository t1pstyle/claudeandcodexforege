"""
FastAPI-зависимости (dependencies).
Переиспользуемые куски, которые вешаются на эндпоинты через Depends(...).
"""
import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.crud.user import get_user_by_id
from app.db.session import get_db
from app.models.user import User

# tokenUrl — путь логина. Swagger UI использует его для кнопки "Authorize" в правом верхнем углу.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_user_from_token(token: str, db: AsyncSession) -> User:
    """Общая JWT-проверка для HTTP-ручек и WebSocket-подключений."""
    credentials_exception = _credentials_exception()
    try:
        payload = decode_access_token(token)
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = uuid.UUID(user_id_str)
    except (jwt.InvalidTokenError, ValueError):
        raise credentials_exception

    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Получает токен из заголовка Authorization: Bearer <token>,
    декодирует, достаёт user_id и загружает пользователя из БД.

    Использование:
        @router.get("/something")
        async def something(user: User = Depends(get_current_user)):
            # user уже загружен, залогинен и активен
            ...
    """
    return await get_user_from_token(token, db)
