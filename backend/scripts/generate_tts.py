"""
Генерация голосовых объявлений для ExamRunner.

Пишем два уровня озвучек:

1) Общий пак — одинаковый для всех вариантов. Хранится в
       backend/uploads/tts/common/<name>.mp3
   Сюда входят фразы, которые сам эмулятор произносит между фазами
   («Now we are ready to start. Task 1», «Task 2», «Start speaking, please»,
   «Question 1» … «Question 5»).

2) Пер-вариантный пак — озвученные вопросы интервью Task 3.
       backend/uploads/tts/variants/<variant_id>/task-<task_id>/q-<n>.mp3
   Вопросы берутся из ExamTask.support_material и парсятся из строк
   вида «1. ...», «2. ...».

Движок — macOS `say` + `ffmpeg` (оффлайн, без API-ключей, достаточно
натурально для эмулятора). Голос по умолчанию — Samantha (en_US).
Скрипт идемпотентен: если mp3 уже существует и команда запущена без
--force, он пропускается.

Запуск:
    cd backend
    source venv/bin/activate
    python -m scripts.generate_tts          # только общий пак
    python -m scripts.generate_tts --all    # + все Task 3 варианты
    python -m scripts.generate_tts --all --force
"""
from __future__ import annotations

import argparse
import asyncio
import re
import shutil
import subprocess
import sys
from pathlib import Path

from sqlalchemy import select

from app.core.config import UPLOADS_DIR
from app.db.session import AsyncSessionLocal
from app.models.exam import ExamTask, TaskType


# ── Пути ──────────────────────────────────────────────────────────────
TTS_ROOT = UPLOADS_DIR / "tts"
COMMON_DIR = TTS_ROOT / "common"
VARIANTS_DIR = TTS_ROOT / "variants"

VOICE = "Samantha"  # en_US, профессионально звучит на macOS
RATE = 180  # слов/мин — немного медленнее обычного, как на экзамене

# ── Фиксированный общий пак ────────────────────────────────────────────
# Ключ становится именем файла: common/<key>.mp3
# Значение — текст для TTS.
COMMON_PHRASES: dict[str, str] = {
    "intro-task-1": "Now we are ready to start. Task 1.",
    "task-2": "Task 2.",
    "task-3": "Task 3.",
    "task-4": "Task 4.",
    "start-speaking": "The time for preparation is over. Start speaking, please.",
    "question-1": "Question 1.",
    "question-2": "Question 2.",
    "question-3": "Question 3.",
    "question-4": "Question 4.",
    "question-5": "Question 5.",
}


def _need_tools() -> None:
    """Проверяем say и ffmpeg — без них скрипт бесполезен."""
    for tool in ("say", "ffmpeg"):
        if shutil.which(tool) is None:
            sys.exit(
                f"× Требуется '{tool}' в PATH. На macOS «say» встроен; ffmpeg ставится через brew."
            )


def _synth_beep(out_path: Path, *, force: bool) -> bool:
    """Короткий сигнал (1 кГц, 0.25с) — играется между под-вопросами Task 2/3."""
    if out_path.exists() and not force:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=0.25",
            "-af",
            "volume=0.35,afade=t=in:st=0:d=0.02,afade=t=out:st=0.22:d=0.03",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "96k",
            str(out_path),
        ],
        check=True,
    )
    return True


def _synth_mp3(text: str, out_path: Path, *, force: bool) -> bool:
    """Сгенерировать mp3 в out_path. Возвращает True, если файл был записан."""
    if out_path.exists() and not force:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # say пишет в aiff, ffmpeg конвертирует в mp3 с разумным битрейтом для речи.
    aiff_path = out_path.with_suffix(".aiff")
    try:
        subprocess.run(
            ["say", "-v", VOICE, "-r", str(RATE), "-o", str(aiff_path), text],
            check=True,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(aiff_path),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "96k",
                str(out_path),
            ],
            check=True,
        )
    finally:
        if aiff_path.exists():
            aiff_path.unlink()
    return True


def generate_common(force: bool) -> None:
    print("→ Общий пак объявлений")
    created = 0
    for key, text in COMMON_PHRASES.items():
        path = COMMON_DIR / f"{key}.mp3"
        if _synth_mp3(text, path, force=force):
            created += 1
            print(f"  ✓ {path.relative_to(UPLOADS_DIR)}")
    # «Тик»-сигнал между под-вопросами Task 2/3.
    beep_path = COMMON_DIR / "beep.mp3"
    if _synth_beep(beep_path, force=force):
        created += 1
        print(f"  ✓ {beep_path.relative_to(UPLOADS_DIR)}")
    print(f"  готово — записано {created} файлов")


# ── Парсер вопросов Task 3 ────────────────────────────────────────────
_NUMBERED = re.compile(r"^\s*(\d+)[.)]\s*(.+?)\s*$")


def _extract_questions(text: str | None) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    for line in text.splitlines():
        m = _NUMBERED.match(line)
        if m:
            out.append(m.group(2))
    return out


async def generate_for_variants(force: bool) -> None:
    print("→ Task 3 по вариантам")
    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(ExamTask).where(ExamTask.task_type == TaskType.INTERVIEW_ANSWERS)
        )
        tasks = q.scalars().all()

    if not tasks:
        print("  нет Task 3 — пропускаю")
        return

    total_written = 0
    for task in tasks:
        questions = _extract_questions(task.support_material)
        if not questions:
            print(f"  · task={task.id}: нет пронумерованных вопросов, пропуск")
            continue
        for idx, text in enumerate(questions, start=1):
            out = (
                VARIANTS_DIR
                / str(task.variant_id)
                / f"task-{task.id}"
                / f"q-{idx}.mp3"
            )
            if _synth_mp3(text, out, force=force):
                total_written += 1
        print(
            f"  · variant={task.variant_id} task={task.id}: {len(questions)} вопросов"
        )
    print(f"  готово — записано {total_written} mp3")


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--all",
        action="store_true",
        help="плюс озвучить Task 3 во всех вариантах БД",
    )
    parser.add_argument(
        "--force", action="store_true", help="перегенерировать существующие файлы"
    )
    args = parser.parse_args()

    _need_tools()
    TTS_ROOT.mkdir(parents=True, exist_ok=True)

    generate_common(force=args.force)
    if args.all:
        await generate_for_variants(force=args.force)


if __name__ == "__main__":
    asyncio.run(main())
