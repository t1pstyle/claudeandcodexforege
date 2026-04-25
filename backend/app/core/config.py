from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Путь к .env в корне проекта: backend/app/core/config.py -> ClaudeProject1/
BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = BASE_DIR
ENV_FILE = BASE_DIR / ".env"


# Куда складываем загруженные аудио-файлы.
# В проде это будет S3/Yandex Object Storage, сейчас — локальная папка.
UPLOADS_DIR = BACKEND_DIR / "uploads"

# Куда положить файлы критериев ЕГЭ (task1_reading_aloud.md и т.д.)
CRITERIA_DIR = Path(__file__).resolve().parent.parent / "evaluation" / "criteria"


class Settings(BaseSettings):
    """
    Настройки приложения. Читаются из .env или переменных окружения.
    """
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Безопасность
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 сутки для dev

    # База данных
    DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # Загрузки
    MAX_UPLOAD_SIZE_MB: int = 25  # макс. размер одного аудио-файла
    ALLOWED_AUDIO_EXTENSIONS: set[str] = {"webm", "mp3", "m4a", "mp4", "ogg", "wav"}

    # AI / OpenAI
    # Если OPENAI_API_KEY пуст ИЛИ USE_REAL_AI=false — работаем в mock-режиме:
    # вместо реальных HTTP-вызовов возвращаем реалистичные заглушки с задержкой,
    # чтобы фронтенд и пайплайн можно было отлаживать бесплатно.
    OPENAI_API_KEY: str = ""
    OPENAI_WHISPER_MODEL: str = "whisper-1"
    OPENAI_GPT_MODEL: str = "gpt-4o"  # для прод-качества. Можно переключить на gpt-4o-mini
    USE_REAL_AI: bool = False

    # Azure Speech (опционально; Task 1 pronunciation assessment).
    # Если ключ пуст — пропускаем, GPT сам ставит балл по транскрипту.
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = "westeurope"


settings = Settings()


def is_real_ai_enabled() -> bool:
    """Реальные вызовы OpenAI возможны только если флаг включён И ключ задан."""
    return settings.USE_REAL_AI and bool(settings.OPENAI_API_KEY.strip())

# Убедимся, что папка для загрузок существует.
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
CRITERIA_DIR.mkdir(parents=True, exist_ok=True)
