"""
Клиент AI-сервисов: Whisper (транскрипция) и GPT-4o (оценка).

ДВА РЕЖИМА:
  1) Mock (USE_REAL_AI=false или OPENAI_API_KEY пуст) —
     возвращает реалистичные заглушки с искусственной задержкой 3-5 сек.
     Нужен для разработки, демо и автотестов без трат на OpenAI.
  2) Real — реальные HTTP-вызовы OpenAI.

Переключение — флагом в .env. Код пайплайна (app/tasks/evaluation.py) ОДИНАКОВ
в обоих режимах. Это важно: когда появится ключ, достаточно сменить флаг.
"""
import asyncio
import json
import logging
import random
from pathlib import Path

from app.core.config import is_real_ai_enabled, settings
from app.evaluation.prompts import build_messages
from app.models.exam import ExamTask, TaskType

logger = logging.getLogger(__name__)


# ----------------------------------------------------------------------------
# ПУБЛИЧНОЕ API
# ----------------------------------------------------------------------------

async def transcribe_audio(audio_path: Path, language: str = "en") -> str:
    """
    Whisper → текст. В mock-режиме возвращает зашитый транскрипт.
    """
    if not is_real_ai_enabled():
        return await _mock_transcribe(audio_path)
    return await _real_transcribe(audio_path, language)


async def evaluate_with_gpt(task: ExamTask, transcript: str) -> tuple[dict, dict]:
    """
    GPT-4o → структурированный JSON разбора.

    Возвращает кортеж (parsed_json, raw_response_meta), где raw_response_meta
    содержит usage и модель (для подсчёта cost_usd_cents и A/B).
    """
    if not is_real_ai_enabled():
        return await _mock_evaluate(task, transcript)
    return await _real_evaluate(task, transcript)


# ----------------------------------------------------------------------------
# РЕАЛЬНЫЕ ВЫЗОВЫ OPENAI
# ----------------------------------------------------------------------------

def _get_openai_client():
    """Ленивое создание клиента. Глобальный синглтон не хранится в модуле,
    чтобы Celery-воркер не тащил соединение между event-loop'ами разных задач."""
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


async def _real_transcribe(audio_path: Path, language: str) -> str:
    client = _get_openai_client()
    with audio_path.open("rb") as f:
        resp = await client.audio.transcriptions.create(
            model=settings.OPENAI_WHISPER_MODEL,
            file=f,
            language=language,
            # response_format=text отдаёт сразу строку, а не объект —
            # меньше токенов на парсинг, быстрее.
            response_format="text",
        )
    # При response_format="text" SDK возвращает строку напрямую.
    text = resp if isinstance(resp, str) else getattr(resp, "text", "")
    return text.strip()


async def _real_evaluate(task: ExamTask, transcript: str) -> tuple[dict, dict]:
    client = _get_openai_client()
    messages = build_messages(task, transcript)
    resp = await client.chat.completions.create(
        model=settings.OPENAI_GPT_MODEL,
        messages=messages,
        # response_format=json_object гарантирует валидный JSON —
        # OpenAI сам отрепромптит модель, если она попробует вернуть markdown.
        response_format={"type": "json_object"},
        # temperature=0 для стабильности оценивания.
        temperature=0,
        # Достаточный бюджет для детального разбора task 4.
        max_tokens=2500,
    )
    raw = resp.choices[0].message.content
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("GPT returned invalid JSON: %s", raw[:500])
        raise ValueError(f"GPT вернул невалидный JSON: {e}")

    meta = {
        "model": resp.model,
        "usage": {
            "prompt_tokens": resp.usage.prompt_tokens,
            "completion_tokens": resp.usage.completion_tokens,
            "total_tokens": resp.usage.total_tokens,
            # В новых версиях SDK есть prompt_tokens_details.cached_tokens
            "cached_tokens": getattr(
                getattr(resp.usage, "prompt_tokens_details", None),
                "cached_tokens", 0,
            ) or 0,
        },
    }
    return parsed, meta


# ----------------------------------------------------------------------------
# MOCK-РЕЖИМ
# ----------------------------------------------------------------------------

# Правдоподобные транскрипты для каждого типа задания. Подобраны так, чтобы
# GPT-оценщик мог бы поставить реалистичный балл (не идеальный, не провальный).
_MOCK_TRANSCRIPTS: dict[TaskType, str] = {
    TaskType.READING_ALOUD: (
        "Happiness is something that every person seeks in life, yet what exactly "
        "makes us happy is surprisingly different for everyone. Modern scientists "
        "who study well-being argue that strong relationships with family and close "
        "friends matter far more than money or professional success. Regular "
        "physical activity, a balanced diet and a healthy amount of sleep also "
        "contribute a great deal to a positive mood and stable emotions. "
        "Interestingly, many researchers agree that helping other people is one of "
        "the most reliable ways to feel genuinely happy yourself. When you do "
        "something kind, your brain releases chemicals that lift your spirits "
        "almost instantly. Spending time outdoors, learning something new, and "
        "setting small personal goals are other proven methods. Finally, experts "
        "remind us that happiness is not a constant state but rather a collection "
        "of meaningful moments."
    ),
    TaskType.COMPOSE_QUESTIONS: (
        "Where is your school located? "
        "How much does one lesson cost? "
        "What levels of English do you teach? "
        "Do you have group classes or only individual lessons?"
    ),
    TaskType.INTERVIEW_ANSWERS: (
        "My favourite hobby is reading. I read almost every evening before bed and I "
        "mostly enjoy science fiction and historical novels. "
        "I started reading seriously when I was about ten years old. My grandmother "
        "gave me a collection of adventure stories and I couldn't stop. "
        "Yes, I think young people read less than before because they spend a lot "
        "of time on social media and video games. Books require more patience. "
        "I usually buy paper books because I like the feeling of turning pages, "
        "but sometimes I read e-books when I travel to save space in my bag. "
        "I would recommend The Hobbit because it has a great story, interesting "
        "characters and it's not too difficult to read in English."
    ),
    TaskType.PHOTO_BASED_STATEMENT: (
        "Hi Mary, I have found two photos for our project about free time activities "
        "of teenagers. Let me tell you about them. In one photo a group of boys is "
        "playing football on a field. In the other photo a girl is sitting at home "
        "and reading a book. The main difference is that one activity is active and "
        "social while the other is quiet and individual. "
        "Both types of activities have their advantages. Playing team sports helps "
        "teenagers stay fit and make friends. Reading books develops imagination "
        "and improves vocabulary. "
        "However, they also have disadvantages. Team sports can be dangerous and "
        "you need other people to play. Reading alone for too long can make "
        "teenagers less social. "
        "As for me, I prefer active hobbies because I like spending time with "
        "friends outdoors. That's all I wanted to tell you. Bye!"
    ),
}


# Готовые JSON-разборы для каждого task_type — чтобы фронт видел реалистичные
# данные с первого же дня, ещё до того как ключ OpenAI появится.
_MOCK_EVALUATIONS: dict[TaskType, dict] = {
    TaskType.READING_ALOUD: {
        "score": 1,
        "phonetic_errors_estimate": 2,
        "major_phonetic_errors_estimate": 0,
        "summary": "Текст прочитан в целом свободно. Есть две небольшие фонетические "
                   "неточности, но смысл не искажён. Балл: 1/1.",
        "strengths": [
            "Интонация повествовательных предложений естественная",
            "Фразовое ударение расставлено правильно в большинстве случаев",
        ],
        "mistakes": [
            {
                "quote": "well-being",
                "issue": "возможен пропуск дефиса-паузы между частями слова",
                "suggestion": "Читать как два соединённых слова с лёгкой паузой: /ˈwel-ˈbiːɪŋ/",
                "severity": "minor",
            },
        ],
        "advice": [
            "Перед чтением глазами пробегись по тексту и найди все сложные слова",
            "Обрати внимание на слова с двумя корнями — ставь ударение на первом",
            "Тренируй чтение в том же темпе, что и в экзамене — не спеши",
        ],
    },
    TaskType.COMPOSE_QUESTIONS: {
        "score": 3,
        "questions": [
            {"index": 1, "question_text": "Where is your school located?", "score": 1, "reason": ""},
            {"index": 2, "question_text": "How much does one lesson cost?", "score": 1, "reason": ""},
            {"index": 3, "question_text": "What levels of English do you teach?", "score": 1, "reason": ""},
            {"index": 4, "question_text": "Do you have group classes or only individual lessons?",
             "score": 0,
             "reason": "Вопрос частично выходит за рамки плана — не соответствует опорному слову 'teachers qualifications'. Нужно было спросить о квалификации преподавателей."},
        ],
        "summary": "Задано 4 прямых вопроса с правильной грамматикой, но четвёртый "
                   "вопрос не соответствует опорному слову. Балл: 3/4.",
        "strengths": [
            "Все 4 вопроса имеют правильную форму прямого вопроса",
            "Использованы разные типы вопросов (специальные и общий)",
        ],
        "mistakes": [
            {
                "quote": "Do you have group classes or only individual lessons?",
                "issue": "Этот вопрос относится к формату занятий, а опорное слово было 'teachers qualifications'",
                "suggestion": "What qualifications do your teachers have?",
                "severity": "major",
            }
        ],
        "advice": [
            "Всегда проверяй, что каждый вопрос точно соответствует своему опорному слову",
            "Тренируй вопросы про квалификацию: What qualifications / experience / certificates...",
        ],
    },
    TaskType.INTERVIEW_ANSWERS: {
        "score": 4,
        "answers": [
            {"index": 1, "interviewer_question": "What is your favourite hobby and why?",
             "student_answer": "My favourite hobby is reading. I read almost every evening before bed and I mostly enjoy science fiction and historical novels.",
             "score": 1, "reason": ""},
            {"index": 2, "interviewer_question": "When and why did you start reading books?",
             "student_answer": "I started reading seriously when I was about ten years old. My grandmother gave me a collection of adventure stories and I couldn't stop.",
             "score": 1, "reason": ""},
            {"index": 3, "interviewer_question": "Do young people read less nowadays than before?",
             "student_answer": "Yes, I think young people read less than before because they spend a lot of time on social media and video games. Books require more patience.",
             "score": 1, "reason": ""},
            {"index": 4, "interviewer_question": "Do you prefer paper books or e-books?",
             "student_answer": "I usually buy paper books because I like the feeling of turning pages, but sometimes I read e-books when I travel to save space in my bag.",
             "score": 1, "reason": ""},
            {"index": 5, "interviewer_question": "Which book would you recommend to a foreign friend?",
             "student_answer": "I would recommend The Hobbit because it has a great story, interesting characters.",
             "score": 0,
             "reason": "Ответ содержит только 1 полную фразу — меньше минимально необходимых 2 фраз."},
        ],
        "summary": "Четыре из пяти ответов даны полно и точно. В пятом ответе не хватает "
                   "развёрнутости. Балл: 4/5.",
        "strengths": [
            "Используются разные грамматические конструкции (Past Simple, Present Simple, would)",
            "Ответы содержат личный пример и обоснование",
        ],
        "mistakes": [
            {
                "quote": "I would recommend The Hobbit because it has a great story, interesting characters.",
                "issue": "Ответ состоит из одной фразы, а требуется минимум 2",
                "suggestion": "Добавь вторую фразу: 'Moreover, the language is not too difficult, so a foreigner can enjoy it.'",
                "severity": "major",
            }
        ],
        "advice": [
            "Всегда давай 2-3 полных фразы, даже на короткий вопрос",
            "Тренируй связки для расширения ответа: Moreover, In addition, What is more...",
            "Следи за временем — укладывайся в 40 секунд на каждый ответ",
        ],
    },
    TaskType.PHOTO_BASED_STATEMENT: {
        "score": 8,
        "task_solution_score": 3,
        "organization_score": 3,
        "language_score": 2,
        "aspects": {
            "1_photos_and_difference": {
                "status": "full",
                "comment": "Обе фотографии описаны с указанием WHO/WHAT/WHERE. Различие сформулировано правильно и связано с темой проекта (активные vs спокойные увлечения).",
            },
            "2_advantages": {
                "status": "full",
                "comment": "Названо по одному достоинству каждого вида активности, связано с темой.",
            },
            "3_disadvantages": {
                "status": "full",
                "comment": "Названо по одному недостатку каждого вида, обосновано.",
            },
            "4_opinion_with_reason": {
                "status": "partial",
                "comment": "Мнение эксплицитно выражено ('As for me, I prefer...'), но обоснование короткое — нужна ещё одна причина для полной глубины.",
            },
        },
        "phrase_count_estimate": 13,
        "opening_present": True,
        "closing_present": True,
        "summary": "Сильный ответ: все 4 аспекта раскрыты, хорошая композиция с "
                   "обращением к другу и заключением. Небольшие потери в языковом "
                   "оформлении. Балл: 8/10.",
        "strengths": [
            "Чёткая композиция: вступление с обращением — основная часть — заключение",
            "Явное указание на различие видов деятельности, связанное с темой",
            "Использование связок: However, As for me",
        ],
        "mistakes": [
            {
                "quote": "Playing team sports helps teenagers stay fit",
                "issue": "пропущен артикль перед 'team sports'",
                "suggestion": "Playing team sports helps teenagers stay fit — здесь артикль не нужен (generic plural); ошибки нет, но в следующей фразе 'reading books develops imagination' — тоже generic, ок. Следи за артиклями в конкретных существительных.",
                "severity": "minor",
            },
            {
                "quote": "As for me, I prefer active hobbies because I like spending time with friends outdoors.",
                "issue": "обоснование мнения короткое — всего одна причина",
                "suggestion": "Добавь вторую причину: 'Moreover, outdoor activities are good for my health and mood.'",
                "severity": "minor",
            },
        ],
        "advice": [
            "Для максимального балла по Аспекту 4 давай минимум 2 причины предпочтения",
            "Используй более сложные связки: 'What is more', 'On top of that', 'From my point of view'",
            "Перед ответом выпиши на черновик по одному достоинству и недостатку — это страховка от забывания",
        ],
    },
}


async def _mock_transcribe(audio_path: Path) -> str:
    """
    Имитирует Whisper: задержка 1-2 секунды, возвращает зашитый транскрипт.
    Тип задания угадываем по каталогу (там путь submissions/<user>/<sub_id>.ext),
    но реально у нас нет task_id — просто вернём PHOTO_BASED_STATEMENT как
    самый длинный и общий, а в реальном вызове task_type учтётся при GPT.

    На самом деле в текущем пайплайне транскрипт не привязывается к task_type
    в момент транскрипции (так же как и у OpenAI) — он просто текст. Точную
    привязку делает GPT. Но для реалистичности mock-а нам нужно разное содержимое
    для разных заданий. Это прокидывается через обёртку mock_transcribe_for_task.
    """
    await _simulate_latency(1.5, 3.0)
    # Если вызов не знает task_type — берём длинный транскрипт по умолчанию.
    return _MOCK_TRANSCRIPTS[TaskType.PHOTO_BASED_STATEMENT]


async def mock_transcribe_for_task(task_type: TaskType) -> str:
    """
    Специализированный mock-транскрайб, знающий тип задания.
    Используется в evaluation task — он знает, какое задание проверяем.
    """
    await _simulate_latency(1.5, 3.0)
    return _MOCK_TRANSCRIPTS[task_type]


async def _mock_evaluate(task: ExamTask, transcript: str) -> tuple[dict, dict]:
    await _simulate_latency(2.0, 4.0)
    parsed = dict(_MOCK_EVALUATIONS[task.task_type])  # shallow copy

    # Добавим в mock реальный транскрипт, если он пришёл — чтобы в ответах/цитатах
    # фронт показывал именно то, что "услышали".
    # (GPT в реальном режиме это делает сам — тут эмулируем.)

    meta = {
        "model": "mock-gpt-4o",
        "usage": {
            "prompt_tokens": 5000,       # правдоподобные цифры из наших расчётов
            "completion_tokens": 800,
            "total_tokens": 5800,
            "cached_tokens": 3500,
        },
    }
    return parsed, meta


async def _simulate_latency(lo: float, hi: float) -> None:
    """Случайная задержка в диапазоне, чтобы mock ощущался как реальная сеть."""
    await asyncio.sleep(random.uniform(lo, hi))
