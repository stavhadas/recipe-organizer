import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config/index.js';
import { verifyYtDlp } from '../services/instagram.js';
import { handleTextMessage, handleDocumentMessage } from './handlers.js';
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
        "Send me a recipe and I'll extract it into a clean, organized format.\n\n" +
        '<b>Supported inputs:</b>\n' +
        '• Any recipe website or magazine URL\n' +
        '• An Instagram post or reel URL\n' +
        '• A PDF or Word (.docx) file — multiple recipes per file supported\n\n' +
        'Type /help for more info.',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
      '<b>How to use:</b>\n\n' +
        '<b>Recipe website / magazine:</b>\n' +
        '• Paste any URL from a recipe site, food blog, or magazine\n' +
        '• e.g. allrecipes.com, bbcgoodfood.com, or any blog\n\n' +
        '<b>Instagram:</b>\n' +
        '• instagram.com/p/... or instagram.com/reel/...\n' +
        '• Post must be public with the recipe in the caption\n\n' +
        '<b>Documents (PDF / Word):</b>\n' +
        '• Send a .pdf or .docx file directly\n' +
        '• Multiple recipes per file are supported\n' +
        '• Brief or incomplete recipes will be expanded by AI (marked as such)',
    );
  });

  bot.on(message('text'), handleTextMessage);
  bot.on(message('document'), handleDocumentMessage);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  await bot.launch();
  console.log('[bot] Recipe Organizer Bot is running. Send /start in Telegram to test it.');
}

main().catch((err) => {
  console.error('[bot] Fatal startup error:', err);
  process.exit(1);
});
