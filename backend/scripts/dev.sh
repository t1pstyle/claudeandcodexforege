#!/usr/bin/env bash
# ------------------------------------------------------------
# Удобный скрипт запуска всего dev-стека.
# Открывает 2 окна в Terminal: uvicorn и celery worker (+beat).
# Перед запуском убедитесь, что Postgres/Redis подняты:
#     docker compose up -d
# ------------------------------------------------------------
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"

osascript <<EOF
tell application "Terminal"
    do script "cd $BACKEND_DIR && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
    do script "cd $BACKEND_DIR && source venv/bin/activate && celery -A app.tasks.celery_app worker --beat --loglevel=info"
end tell
EOF

echo "✓ Открыты 2 окна Terminal: API (порт 8000) и Celery worker+beat."
