"""
Наполняет БД одним демо-вариантом ЕГЭ с 4 заданиями.

Запуск:
    cd backend
    source venv/bin/activate
    python -m scripts.seed_variants
"""
import asyncio

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.exam import ExamTask, ExamVariant, TaskType


DEMO_VARIANT_TITLE = "Демо-вариант №1"


# Время в секундах.  90с = 1.5 мин,  150с = 2.5 мин.
SAMPLE_TASKS = [
    # ---------- Задание 1: чтение вслух (~160 слов) ----------
    {
        "task_number": 1,
        "task_type": TaskType.READING_ALOUD,
        "prompt_text": (
            "Imagine that you are doing a project on what makes people happy. "
            "You have found some information on this topic. You are going to read "
            "the passage out loud to your friend. You have 1.5 minutes to read the "
            "passage silently, then be ready to read it aloud. You will not have "
            "more than 1.5 minutes to read it."
        ),
        "support_material": (
            "Happiness is something that every person seeks in life, yet what exactly "
            "makes us happy is surprisingly different for everyone. Modern scientists "
            "who study well-being argue that strong relationships with family and "
            "close friends matter far more than money or professional success. "
            "Regular physical activity, a balanced diet and a healthy amount of sleep "
            "also contribute a great deal to a positive mood and stable emotions. "
            "Interestingly, many researchers agree that helping other people is one "
            "of the most reliable ways to feel genuinely happy yourself. When you do "
            "something kind, your brain releases chemicals that lift your spirits "
            "almost instantly. Spending time outdoors, learning something new, and "
            "setting small personal goals are other proven methods. Finally, experts "
            "remind us that happiness is not a constant state but rather a collection "
            "of meaningful moments. Noticing and appreciating these moments, even the "
            "smallest ones, may be the most important habit of all for a happy life."
        ),
        "image_url": None,
        "image2_url": None,
        "prep_seconds": 90,
        "speak_seconds": 90,
    },

    # ---------- Задание 2: составить 4 вопроса по объявлению ----------
    {
        "task_number": 2,
        "task_type": TaskType.COMPOSE_QUESTIONS,
        "prompt_text": (
            "Study the advertisement below. You are considering the programme and "
            "now you'd like to get more information. In 1.5 minutes you are to ask "
            "FOUR direct questions to find out about the following:\n"
            "1) location of the language school\n"
            "2) course duration\n"
            "3) group size\n"
            "4) discounts for students"
        ),
        "support_material": (
            "INTERNATIONAL SUMMER LANGUAGE SCHOOL\n"
            "Learn English with native speakers!\n"
            "Intensive courses for teenagers (14–18).\n"
            "Small friendly groups • Qualified teachers • Certificates • Group discounts"
        ),
        # Картинку объявления подгрузим позже.
        "image_url": None,
        "image2_url": None,
        "prep_seconds": 90,
        "speak_seconds": 60,
    },

    # ---------- Задание 3: ответы на 5 вопросов интервью ----------
    {
        "task_number": 3,
        "task_type": TaskType.INTERVIEW_ANSWERS,
        "prompt_text": (
            "You are taking part in a telephone survey on the topic \"Books and "
            "reading in a teenager's life\". You will have to answer five questions. "
            "Give full answers to the questions (2–3 sentences). Remember to give as "
            "many details as possible."
        ),
        "support_material": (
            "1. How often do you read books and why?\n"
            "2. What kinds of books do you prefer — paper or electronic, and why?\n"
            "3. Who is your favourite writer, and what do you like most about their books?\n"
            "4. Do you think reading will remain popular with teenagers in the future? Why?\n"
            "5. What book would you recommend to me and why?"
        ),
        "image_url": None,
        "image2_url": None,
        "prep_seconds": 90,
        "speak_seconds": 120,
    },

    # ---------- Задание 4: высказывание по 2 фото + обоснование ----------
    {
        "task_number": 4,
        "task_type": TaskType.PHOTO_BASED_STATEMENT,
        "prompt_text": (
            "Imagine that you and your friend are choosing a photograph to send "
            "to an international teenage magazine. You have to decide which of the "
            "two photographs to send. In 2.5 minutes prepare a short monologue. "
            "You have to speak continuously for not more than 3 minutes, covering:\n"
            "• give a brief description of both photos (action, location)\n"
            "• say what the two photos have in common\n"
            "• say in what way the two photos are different\n"
            "• explain which of the two photos you'd choose to send and why\n"
            "• say what your friend's attitude to the situation in the other photo might be"
        ),
        "support_material": (
            "Problem question: \"How do teenagers prefer to spend their free time today?\""
        ),
        "image_url": None,
        "image2_url": None,
        "prep_seconds": 150,   # 2.5 минуты
        "speak_seconds": 180,  # до 3 минут
    },
]


async def main() -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(ExamVariant).where(ExamVariant.title == DEMO_VARIANT_TITLE)
        )
        if existing.scalar_one_or_none():
            print(f"✓ Вариант '{DEMO_VARIANT_TITLE}' уже есть, пропускаю seed.")
            return

        variant = ExamVariant(
            title=DEMO_VARIANT_TITLE,
            description="Демонстрационный вариант для проверки пайплайна.",
            is_published=True,
        )
        db.add(variant)
        await db.flush()

        for task_data in SAMPLE_TASKS:
            db.add(ExamTask(variant_id=variant.id, **task_data))

        await db.commit()
        print(f"✓ Создан вариант '{DEMO_VARIANT_TITLE}' с {len(SAMPLE_TASKS)} заданиями.")
        print(f"  variant.id = {variant.id}")


if __name__ == "__main__":
    asyncio.run(main())
