#!/bin/bash
set -e

# Read configuration supplied by Home Assistant Supervisor
export TELEGRAM_BOT_TOKEN=$(jq --raw-output '.telegram_bot_token' /data/options.json)
export GEMINI_API_KEY=$(jq --raw-output '.gemini_api_key' /data/options.json)
export GEMINI_MODEL=$(jq --raw-output '.gemini_model // "gemini-2.5-flash"' /data/options.json)

# Fixed values inside the container
export WEB_PORT=3000
export DB_PATH=/data/recipes.db

exec node /app/dist/bot/index.js
