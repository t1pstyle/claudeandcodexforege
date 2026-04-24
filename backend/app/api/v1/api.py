"""
Сборка всех v1-роутеров в один. Подключается к приложению в main.py.
"""
from fastapi import APIRouter

from app.api.v1 import auth, submissions, users, variants

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(variants.router)
api_router.include_router(submissions.router)
