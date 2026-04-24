import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, computed_field

from app.core.config import UPLOADS_DIR
from app.models.exam import TaskType


_NUMBERED_RE = re.compile(r"^\s*(\d+)[.)]\s*(.+?)\s*$")


class ExamTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_number: int
    task_type: TaskType
    prompt_text: str
    support_material: str | None = None
    image_url: str | None = None
    image2_url: str | None = None
    prep_seconds: int
    speak_seconds: int
    variant_id: uuid.UUID

    @computed_field  # type: ignore[misc]
    @property
    def interview_audio_urls(self) -> list[str]:
        """
        Для Task 3 — список URL'ов к mp3 с озвученными вопросами
        (генерируются `scripts/generate_tts.py`). Для остальных типов — [].

        URL предсказуемый: /static/tts/variants/<variant_id>/task-<task_id>/q-<N>.mp3.
        Отдаём только те, файлы которых реально существуют — если генерацию
        не запускали, фронт просто откатится на SpeechSynthesis.
        """
        if self.task_type != TaskType.INTERVIEW_ANSWERS or not self.support_material:
            return []

        count = 0
        for line in self.support_material.splitlines():
            if _NUMBERED_RE.match(line):
                count += 1
        if count == 0:
            return []

        base_dir = (
            UPLOADS_DIR
            / "tts"
            / "variants"
            / str(self.variant_id)
            / f"task-{self.id}"
        )
        urls: list[str] = []
        for n in range(1, count + 1):
            mp3 = base_dir / f"q-{n}.mp3"
            if mp3.exists():
                urls.append(f"/static/tts/variants/{self.variant_id}/task-{self.id}/q-{n}.mp3")
            else:
                urls.append("")  # заглушка — фронт поймёт и откатится на TTS
        return urls


class ExamVariantShort(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    created_at: datetime


class ExamVariantRead(ExamVariantShort):
    tasks: list[ExamTaskRead] = []
