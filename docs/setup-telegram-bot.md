# Setting Up Your Telegram Bot

## Step 1 — Create the bot

1. Open Telegram and search for **@BotFather**
2. Start a chat and send the command: `/newbot`
3. BotFather will ask for a **display name** — this is what users see (e.g. `My Recipe Bot`)
4. Then it will ask for a **username** — must end in `bot` (e.g. `my_recipe_organizer_bot`)
5. BotFather replies with your bot token, which looks like:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

## Step 2 — Add the token to your project

Copy the token and add it to your `.env` file:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

## Step 3 — (Optional) Configure bot commands

In BotFather, send `/setcommands`, select your bot, then paste:

```
start - Start the bot
help - How to use the bot
```

This adds a command menu in the Telegram UI.

## Step 4 — Test it

1. Start the bot: `npm run dev`
2. Open your bot in Telegram (search for the username you chose)
3. Send `/start` — you should see the welcome message

## Notes

- The bot only receives messages **while it's running**. If you stop `npm run dev`, the bot goes offline.
- Keep your token secret — anyone with the token can control your bot.
- To get a new token at any time, send `/revoke` to BotFather.
