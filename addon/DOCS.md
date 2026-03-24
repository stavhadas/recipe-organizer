# Recipe Organizer — Setup

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A Google Gemini API key from [aistudio.google.com](https://aistudio.google.com/apikey)

## Configuration

| Option | Required | Description |
|---|---|---|
| `telegram_bot_token` | Yes | Token from @BotFather |
| `gemini_api_key` | Yes | Google Gemini API key |
| `gemini_model` | No | Model name (default: `gemini-2.5-flash`) |

## Usage

1. Start the add-on.
2. Open **Recipe Vault** in the HA sidebar.
3. Send an Instagram recipe post or reel URL to your Telegram bot.
4. The extracted recipe appears in the vault automatically.

## Data

Recipes are stored in `/data/recipes.db` inside the add-on's persistent data directory.
They survive add-on restarts and updates.

## Accessing the Vault

- **HA Sidebar**: Click "Recipe Vault" — embedded via Ingress, no extra port needed.
- **Direct**: `http://homeassistant.local:3000` (requires port 3000 to be open).
