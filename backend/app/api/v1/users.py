from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.user import UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/me",
    response_model=UserRead,
    summary="Данные текущего пользователя",
)
async def read_me(current_user: User = Depends(get_current_user)):
    """
    Возвращает данные залогиненного пользователя.
    Требует заголовок Authorization: Bearer <JWT>.
    """
    return current_user
