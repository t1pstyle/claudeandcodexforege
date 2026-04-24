import uuid
from pathlib import Path
import asyncio

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_user_from_token
from app.core.config import UPLOADS_DIR, settings
from app.crud import evaluation as evaluation_crud
from app.crud import exam as exam_crud
from app.crud import submission as submission_crud
from app.db.session import AsyncSessionLocal, get_db
from app.models.submission import SubmissionStatus
from app.models.user import User
from app.schemas.evaluation import EvaluationRead
from app.schemas.submission import SubmissionRead
from app.tasks.evaluation import evaluate_submission

router = APIRouter(prefix="/submissions", tags=["submissions"])

MAX_UPLOAD_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
WS_POLL_INTERVAL_SEC = 1.0


def _extension_from_filename(filename: str | None) -> str:
    if not filename:
        return "webm"
    ext = Path(filename).suffix.lstrip(".").lower()
    return ext or "webm"


def _status_message(status_value: SubmissionStatus, *, error_message: str | None) -> str:
    if status_value == SubmissionStatus.PENDING_AI:
        return "Запись загружена. Задача ждёт своей очереди на AI-проверку."
    if status_value == SubmissionStatus.PROCESSING:
        return "AI сейчас расшифровывает и проверяет ответ по критериям ФИПИ."
    if status_value == SubmissionStatus.EVALUATED:
        return "Разбор готов."
    if status_value == SubmissionStatus.FAILED:
        return error_message or "Во время AI-проверки произошла ошибка."
    return "Запись загружена."


async def _build_ws_payload(db: AsyncSession, submission_id: uuid.UUID) -> dict | None:
    submission = await submission_crud.get_submission(db, submission_id)
    if submission is None:
        return None

    payload = {
        "type": "status",
        "submission_id": str(submission.id),
        "task_id": str(submission.task_id),
        "task_number": submission.task.task_number,
        "status": submission.status.value,
        "ai_requested": submission.ai_requested,
        "error_message": submission.error_message,
        "updated_at": submission.updated_at.isoformat(),
        "message": _status_message(
            submission.status,
            error_message=submission.error_message,
        ),
    }

    if submission.status == SubmissionStatus.EVALUATED:
        evaluation = await evaluation_crud.get_evaluation_by_submission(db, submission.id)
        if evaluation is not None:
            payload["evaluation"] = jsonable_encoder(
                EvaluationRead.model_validate(evaluation)
            )

    return payload


@router.post(
    "",
    response_model=SubmissionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить запись ответа на задание",
)
async def upload_submission(
    task_id: uuid.UUID = Form(...),
    ai_requested: bool = Form(False),
    audio: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Принимает multipart/form-data:

    - **task_id** — UUID задания из варианта.
    - **ai_requested** — `true` если пользователь заказал AI-оценку.
      Проверяем, что есть `paid_checks_available > 0`, списываем одну.
      Запись останется в личном кабинете с результатом AI.
    - **ai_requested=false** — бесплатный сценарий.
      Пользователь сможет прослушать/скачать файл; через 24ч запись и файл удаляются.
    - **audio** — файл (webm/mp3/m4a/mp4/ogg/wav), до 25 МБ.

    Файл стримится на диск кусками по 1 МБ, чтобы не грузить весь объём в память.
    """
    # 1. Проверяем задание
    task = await exam_crud.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задание не найдено")

    # 2. Валидируем расширение
    ext = _extension_from_filename(audio.filename)
    if ext not in settings.ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Формат .{ext} не поддерживается. "
                   f"Разрешены: {sorted(settings.ALLOWED_AUDIO_EXTENSIONS)}",
        )

    # 3. Если заказан AI — нужна оплаченная проверка
    if ai_requested and current_user.paid_checks_available <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Нет оплаченных AI-проверок. Пополните баланс.",
        )

    # 4. Генерим id заранее — имя файла и id записи совпадут.
    submission_id = uuid.uuid4()
    user_dir = UPLOADS_DIR / "submissions" / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    file_path = user_dir / f"{submission_id}.{ext}"
    relative_path = f"submissions/{current_user.id}/{submission_id}.{ext}"

    # 5. Стримим файл на диск, следим за размером.
    total = 0
    CHUNK = 1024 * 1024  # 1 МБ
    try:
        with file_path.open("wb") as f:
            while chunk := await audio.read(CHUNK):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    f.close()
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Файл превышает {settings.MAX_UPLOAD_SIZE_MB} МБ",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Не удалось сохранить файл: {e}",
        )

    # 6. Списываем платную проверку
    if ai_requested:
        current_user.paid_checks_available -= 1
        db.add(current_user)

    # 7. Создаём запись в БД с тем же id, что и имя файла.
    submission = await submission_crud.create_submission(
        db,
        submission_id=submission_id,
        user_id=current_user.id,
        task_id=task.id,
        audio_path=relative_path,
        audio_mime_type=audio.content_type or f"audio/{ext}",
        audio_size_bytes=total,
        ai_requested=ai_requested,
    )

    # 8. Если заказан AI — кладём задачу в Celery-очередь.
    # .delay() возвращает сразу, юзер увидит status=pending_ai,
    # воркер подберёт и начнёт обработку.
    if ai_requested:
        evaluate_submission.delay(str(submission.id))

    return submission


@router.get(
    "",
    response_model=list[SubmissionRead],
    summary="Мои записи (по умолчанию все; ?only_paid=true — только платные с AI)",
)
async def list_submissions(
    only_paid: bool = Query(False, description="Только платные проверки с AI-результатами"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await submission_crud.list_user_submissions(
        db, current_user.id, only_paid=only_paid,
    )


@router.get(
    "/{submission_id}/audio",
    summary="Скачать/прослушать аудио записи",
)
async def download_audio(
    submission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    submission = await submission_crud.get_submission(db, submission_id)
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if submission.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Чужая запись")

    if not submission.audio_path:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Аудиофайл уже удалён (истёк срок хранения или AI завершил обработку)",
        )

    full_path = UPLOADS_DIR / submission.audio_path
    if not full_path.exists():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Файл больше не доступен")

    return FileResponse(
        path=str(full_path),
        media_type=submission.audio_mime_type or "audio/webm",
        filename=full_path.name,
    )


@router.get(
    "/{submission_id}/evaluation",
    response_model=EvaluationRead,
    summary="Получить AI-разбор ответа",
)
async def get_evaluation(
    submission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Возвращает разбор (Evaluation) по данному submission.

    Статусы HTTP:
    - **200** — разбор готов
    - **202** — submission ещё в обработке (pending_ai / processing),
      фронту надо периодически опрашивать
    - **403** — чужой submission
    - **404** — submission не существует
    - **409** — status=failed (разбор не получится, см. error_message в submission)
    - **410** — разбор не заказан (ai_requested=False)
    """
    submission = await submission_crud.get_submission(db, submission_id)
    if submission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Запись не найдена")
    if submission.user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Чужая запись")
    if not submission.ai_requested:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="AI-разбор для этой записи не заказывался",
        )
    if submission.status == SubmissionStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=submission.error_message or "Ошибка обработки",
        )
    if submission.status in (SubmissionStatus.UPLOADED, SubmissionStatus.PENDING_AI,
                             SubmissionStatus.PROCESSING):
        # 202 Accepted — фронт должен опросить позже (или подключиться к WebSocket)
        raise HTTPException(
            status_code=status.HTTP_202_ACCEPTED,
            detail=f"Разбор ещё готовится (status={submission.status.value})",
        )

    evaluation = await evaluation_crud.get_evaluation_by_submission(db, submission.id)
    if evaluation is None:
        # Теоретически недостижимо (status=EVALUATED должно подразумевать наличие записи),
        # но защищаемся от гонок.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Разбор не найден",
        )
    return evaluation


@router.websocket("/{submission_id}/ws")
async def submission_status_ws(websocket: WebSocket, submission_id: uuid.UUID):
    """
    WebSocket для live-статуса AI-разбора.

    Авторизация идёт через query param `token`, потому что браузерный WebSocket
    не умеет удобно отправлять Bearer-токен заголовком. Соединение держим
    лёгким: просто проверяем БД раз в секунду и шлём обновление, когда статус
    изменился или разбор готов.
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401, reason="Missing token")
        return

    async with AsyncSessionLocal() as db:
        try:
            current_user = await get_user_from_token(token, db)
        except HTTPException:
            await websocket.close(code=4401, reason="Unauthorized")
            return

        submission = await submission_crud.get_submission(db, submission_id)
        if submission is None:
            await websocket.close(code=4404, reason="Submission not found")
            return
        if submission.user_id != current_user.id and not current_user.is_superuser:
            await websocket.close(code=4403, reason="Forbidden")
            return

    await websocket.accept()

    last_fingerprint: tuple[str, str, str | None] | None = None

    try:
        while True:
            async with AsyncSessionLocal() as db:
                payload = await _build_ws_payload(db, submission_id)

            if payload is None:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "not_found",
                        "message": "Запись больше не существует.",
                    }
                )
                return

            fingerprint = (
                payload["status"],
                payload["updated_at"],
                payload["error_message"],
            )
            if fingerprint != last_fingerprint:
                await websocket.send_json(payload)
                last_fingerprint = fingerprint

            if payload["status"] in (
                SubmissionStatus.EVALUATED.value,
                SubmissionStatus.FAILED.value,
            ):
                return

            await asyncio.sleep(WS_POLL_INTERVAL_SEC)
    except WebSocketDisconnect:
        return
