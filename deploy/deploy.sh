#!/usr/bin/env bash
# Clarifin production deploy — invoked by the git-push webhook (webhook.py) or manually.
# Pull latest main, rebuild images, run migrations, restart services. Single-flight:
# a lock file prevents two pushes from deploying on top of each other.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/mizan}"
LOCK_FILE="/tmp/clarifin-deploy.lock"
LOG_FILE="${LOG_FILE:-/var/log/clarifin-deploy.log}"

exec >>"$LOG_FILE" 2>&1

if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  echo "[$(date -Is)] deploy already running — skipped"
  exit 0
fi
trap 'rmdir "$LOCK_FILE"' EXIT

echo "[$(date -Is)] deploy started"
cd "$REPO_DIR"

git fetch origin main
git reset --hard origin/main

docker compose build backend frontend
docker compose up -d
docker compose exec -T backend alembic upgrade head

echo "[$(date -Is)] deploy finished — $(git rev-parse --short HEAD)"
