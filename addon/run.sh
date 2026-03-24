#!/bin/sh
set -e

OPTIONS_FILE="/data/options.json"

if [ ! -f "$OPTIONS_FILE" ]; then
  echo "[run.sh] ERROR: $OPTIONS_FILE not found. Configure the add-on options first."
  exit 1
fi

TELEGRAM_BOT_TOKEN=$(jq --raw-output '.telegram_bot_token // empty' "$OPTIONS_FILE")
GEMINI_API_KEY=$(jq --raw-output '.gemini_api_key // empty' "$OPTIONS_FILE")
GEMINI_MODEL=$(jq --raw-output '.gemini_model // "gemini-2.5-flash"' "$OPTIONS_FILE")

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "[run.sh] ERROR: telegram_bot_token is not set. Fill it in the add-on Configuration tab."
  exit 1
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "[run.sh] ERROR: gemini_api_key is not set. Fill it in the add-on Configuration tab."
  exit 1
fi

export TELEGRAM_BOT_TOKEN
export GEMINI_API_KEY
export GEMINI_MODEL
export WEB_PORT=3000
export DB_PATH=/data/recipes.db

echo "[run.sh] Starting Recipe Organizer v$(grep '^version' /data/options.json 2>/dev/null || true)..."
exec node /app/dist/bot/index.js
