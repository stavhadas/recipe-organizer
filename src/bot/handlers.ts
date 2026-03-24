import type { Context } from 'telegraf';
import { isInstagramUrl, normalizeInstagramUrl, extractTextUrls } from '../utils/urlParser.js';
import { fetchInstagramPost, InstagramError } from '../services/instagram.js';
import { extractRecipe, GeminiError } from '../services/gemini.js';
import { formatRecipeAsHtml, splitHtmlMessage } from '../services/formatter.js';
import { RecipeSchema } from '../models/recipe.js';
import { saveRecipe } from '../db/database.js';

function resolveUserMessage(err: unknown): string {
  if (err instanceof InstagramError) {
    switch (err.code) {
      case 'PRIVATE_POST':
        return '🔒 This post is private or requires login. Please try a public post.';
      case 'NOT_FOUND':
        return '❌ Post not found. It may have been deleted — check the URL.';
      case 'NO_CAPTION':
        return '📭 This post has no caption text, so there is nothing to extract a recipe from.';
      case 'RATE_LIMITED':
        return '⏳ Instagram is rate limiting requests right now. Please try again in a few minutes.';
      default:
        return '⚠️ Failed to fetch the Instagram post. Please try again.';
    }
  }

  if (err instanceof GeminiError) {
    if (err.code === 'NO_RECIPE') {
      const reason = err.reason ? `\n\n${err.reason}` : '';
      return `🍽️ This post doesn't appear to contain a recipe.${reason}`;
    }
    return '⚠️ Failed to extract the recipe from this post. The caption may be in an unusual format.';
  }

  console.error('[handler] Unexpected error:', err);
  return '⚠️ An unexpected error occurred. Please try again.';
}

export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text;
  const urls = extractTextUrls(text).filter(isInstagramUrl);

  if (urls.length === 0) {
    // Only respond if the user seems to be trying to send a URL
    if (text.startsWith('http')) {
      await ctx.reply(
        'Please send an Instagram post or reel URL.\n' +
          'Example: https://www.instagram.com/p/ABC123/',
      );
    }
    return;
  }

  const url = normalizeInstagramUrl(urls[0]!);

  // Send immediate loading message
  const loadingMsg = await ctx.replyWithHTML(
    `⏳ Fetching recipe...\n<code>${url}</code>`,
    { link_preview_options: { is_disabled: true } },
  );

  const editLoading = async (text: string) => {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      undefined,
      text,
    );
  };

  try {
    // Step 1: Fetch Instagram post
    const post = await fetchInstagramPost(url);

    // Step 2: Extract recipe via Gemini
    const extracted = await extractRecipe(post.caption);

    // Step 3: Build full Recipe with metadata
    const recipe = RecipeSchema.parse({
      ...extracted,
      sourceUrl: url,
      extractedAt: new Date().toISOString(),
      _raw: post.caption,
    });

    // Step 3b: Persist to database (non-fatal)
    try {
      saveRecipe(recipe);
    } catch (dbErr) {
      console.error('[handler] DB save failed:', dbErr);
    }

    // Step 4: Format and reply
    const html = formatRecipeAsHtml(recipe);
    const chunks = splitHtmlMessage(html, 4096);

    if (chunks.length === 1) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        chunks[0]!,
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      );
    } else {
      // Too long — delete loading message and send multiple parts
      await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk, { link_preview_options: { is_disabled: true } });
      }
    }
  } catch (err) {
    await editLoading(resolveUserMessage(err));
  }
}
