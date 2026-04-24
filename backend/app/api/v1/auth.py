from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.crud import user as user_crud
from app.db.session import get_db
from app.schemas.user import Token, UserCreate, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Регистрация нового пользователя",
)
async def register(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Создаёт аккаунт с email + паролем.
    Пароль хэшируется перед сохранением.
    Возвращает данные пользователя (БЕЗ пароля).
    """
    existing = await user_crud.get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким email уже существует",
        )
    return await user_crud.create_user(db, payload)


@router.post(
    "/login",
    response_model=Token,
    summary="Вход — получить JWT-токен",
)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth2 password flow. Запрос должен быть application/x-www-form-urlencoded,
    НЕ JSON — это стандарт OAuth2, которого требует Swagger UI "Authorize".

    Поля формы:
    - username = email
    - password = пароль
    """
    user = await user_crud.authenticate(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(subject=user.id)
    return Token(access_token=token)
