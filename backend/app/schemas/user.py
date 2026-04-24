import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    """Общие поля, которые встречаются и в запросе, и в ответе."""
    email: EmailStr
    full_name: str | None = None


class UserCreate(UserBase):
    """Тело запроса на регистрацию."""
    password: str = Field(min_length=8, max_length=128)


class UserRead(UserBase):
    """
    То, что мы возвращаем клиенту.
    ВАЖНО: здесь нет hashed_password — пароль наружу никогда не уходит.
    """
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool
    is_superuser: bool
    paid_checks_available: int
    created_at: datetime


class Token(BaseModel):
    """Ответ на /auth/login."""
    access_token: str
    token_type: str = "bearer"
