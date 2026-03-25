import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config/index.js';
import { verifyYtDlp } from '../services/instagram.js';
import { handleTextMessage } from './handlers.js';
import { startWebServer } from '../web/server.js';
import { backfillStepIngredients, backfillLabels } from '../services/migration.js';

async function main(): Promise<void> {
  // Check yt-dlp at startup (non-fatal — HTTP fallback is available)
  await verifyYtDlp();

  startWebServer();

  // Backfill per-step ingredients for recipes fetched before that feature existed.
  // Runs in the background — does not block bot startup.
  backfillStepIngredients().catch((err) =>
    console.error('[migration] backfillStepIngredients failed:', err),
  );

  // Backfill labels for recipes saved before auto-labeling was added.
  backfillLabels().catch((err) =>
    console.error('[migration] backfillLabels failed:', err),
  );

  const bot = new Telegraf(config.telegram.botToken);

  // Log incoming messages
  bot.use(async (ctx, next) => {
    const user = ctx.from?.username ?? String(ctx.from?.id ?? 'unknown');
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '(non-text)';
    console.log(`[${new Date().toISOString()}] @${user}: ${text.slice(0, 80)}`);
    return next();
  });

  bot.command('start', async (ctx) => {
    await ctx.replyWithHTML(
      '<b>Recipe Organizer Bot 🍳</b>\n\n' +
        'Send me an Instagram post or reel URL that contains a recipe ' +
        "and I'll extract it into a clean, organized format.\n\n" +
        '<b>Example:</b>\n' +
        '<code>https://www.instagram.com/p/ABC123/</code>\n\n' +
        'Type /help for more info.',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
      '<b>How to use:</b>\n\n' +
        '1. Find a recipe post on Instagram\n' +
        '2. Copy the post URL\n' +
        '3. Paste it here\n\n' +
        '<b>Supported URLs:</b>\n' +
        '• instagram.com/p/...\n' +
        '• instagram.com/reel/...\n\n' +
        '<b>Note:</b> The post must be public and have the recipe written in the caption text.\n\n' +
        'Reels without text captions are not supported yet (coming in a future update).',
    );
  });

  bot.on(message('text'), handleTextMessage);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  await bot.launch();
  console.log('[bot] Recipe Organizer Bot is running. Send /start in Telegram to test it.');
}

main().catch((err) => {
  console.error('[bot] Fatal startup error:', err);
  process.exit(1);
});
