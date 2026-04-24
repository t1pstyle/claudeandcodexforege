import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import exam as exam_crud
from app.db.session import get_db
from app.schemas.exam import ExamVariantRead, ExamVariantShort

router = APIRouter(prefix="/variants", tags=["exam"])


@router.get(
    "",
    response_model=list[ExamVariantShort],
    summary="Список опубликованных вариантов ЕГЭ",
)
async def list_variants(db: AsyncSession = Depends(get_db)):
    return await exam_crud.list_published_variants(db)


@router.get(
    "/{variant_id}",
    response_model=ExamVariantRead,
    summary="Вариант целиком со всеми 4 заданиями",
)
async def get_variant(
    variant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    variant = await exam_crud.get_variant_with_tasks(db, variant_id)
    if variant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Вариант не найден")
    return variant
