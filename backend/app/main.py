from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.api import api_router
from app.core.config import UPLOADS_DIR
from app.db.session import get_db

# Создаём приложение FastAPI.
app = FastAPI(
    title="Speaking Exam Trainer API",
    description="AI-тренажёр устной части ЕГЭ по английскому",
    version="0.1.0",
)

# Разрешаем фронтенду обращаться к API из браузера в dev:
# - localhost на текущем устройстве
# - адреса локальной сети, чтобы открывать сайт с телефона/планшета
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем роутер v1: все эндпоинты будут под /api/v1/...
app.include_router(api_router)

# ── TTS-объявления для экзамена ───────────────────────────────────────
# Плейер в браузере берёт готовые mp3 (сгенерённые scripts/generate_tts.py)
# по предсказуемым путям. Папка гитигнорится.
_tts_dir = UPLOADS_DIR / "tts"
_tts_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/tts", StaticFiles(directory=_tts_dir), name="tts")


# ----------------------------------------------------------------------
# Служебные эндпоинты (без префикса — нужны мониторингу / Docker healthcheck)
# ----------------------------------------------------------------------
@app.get("/health", tags=["service"])
async def health_check():
    """Сервер жив?"""
    return {
        "status": "ok",
        "service": "speaking-exam-trainer",
    }


@app.get("/", tags=["service"])
async def root():
    """Корень — подсказка, где документация."""
    return {
        "message": "Speaking Exam Trainer API",
        "docs": "/docs",
    }


@app.get("/db-check", tags=["service"])
async def db_check(db: AsyncSession = Depends(get_db)):
    """Проверка соединения с PostgreSQL."""
    result = await db.execute(text("SELECT 1"))
    return {
        "db": "ok",
        "select_1": result.scalar(),
    }
