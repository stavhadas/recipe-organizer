import crypto from 'crypto';
import type { Context } from 'telegraf';
import axios from 'axios';
import { isInstagramUrl, normalizeInstagramUrl, extractTextUrls } from '../utils/urlParser.js';
import { fetchInstagramPost, InstagramError } from '../services/instagram.js';
import { extractRecipe, extractRecipesFromDocument, GeminiError } from '../services/gemini.js';
import { formatRecipeAsHtml, splitHtmlMessage } from '../services/formatter.js';
import { RecipeSchema } from '../models/recipe.js';
import { saveRecipe } from '../db/database.js';
import { extractDocxText } from '../services/documentParser.js';

const SUPPORTED_MIME_TYPES: Record<string, 'pdf' | 'docx'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

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

export async function handleDocumentMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !('document' in ctx.message)) return;

  const doc = ctx.message.document;
  const mimeType = doc.mime_type ?? '';
  const fileType = SUPPORTED_MIME_TYPES[mimeType];

  if (!fileType) {
    await ctx.reply('Please send a PDF or Word (.docx) file containing recipes.');
    return;
  }

  const filename = doc.file_name ?? `document.${fileType}`;
  const loadingMsg = await ctx.replyWithHTML(
    `⏳ Processing <b>${filename}</b>...\nExtracting recipes from document.`,
  );

  const editLoading = async (text: string) => {
    try {
      await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, text);
    } catch {
      // ignore edit failures
    }
  };

  try {
    // Download the file
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await axios.get<Buffer>(fileLink.href, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // Compute file hash for deduplication
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    // Prepare input for Gemini
    let pdfBuffer: Buffer | undefined;
    let docText: string | undefined;

    if (fileType === 'pdf') {
      pdfBuffer = buffer;
    } else {
      docText = await extractDocxText(buffer);
      if (!docText.trim()) {
        await editLoading('❌ Could not extract any text from this document.');
        return;
      }
    }

    await editLoading(`⏳ Analysing recipes in <b>${filename}</b>...`);

    const recipes = await extractRecipesFromDocument({
      pdf: pdfBuffer,
      text: docText,
      filename,
    });

    // Delete loading message, then send each recipe
    await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);

    if (recipes.length === 0) {
      await ctx.reply('🍽️ No recipes were found in this document.');
      return;
    }

    await ctx.replyWithHTML(
      `✅ Found <b>${recipes.length}</b> recipe${recipes.length !== 1 ? 's' : ''} in <b>${filename}</b>:`,
    );

    for (const extracted of recipes) {
      const titleSlug = extracted.title
        .toLowerCase()
        .replace(/[^a-z0-9\u0080-\uFFFF]+/g, '-')
        .slice(0, 60);
      const sourceUrl = `doc://${fileHash}/${titleSlug}`;

      const recipe = RecipeSchema.parse({
        ...extracted,
        aiCompleted: extracted.aiCompleted ?? false,
        sourceUrl,
        extractedAt: new Date().toISOString(),
        _raw: docText ?? null,
      });

      try {
        saveRecipe(recipe);
      } catch (dbErr) {
        console.error('[handler] DB save failed for document recipe:', dbErr);
      }

      const html = formatRecipeAsHtml(recipe);
      const chunks = splitHtmlMessage(html, 4096);
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk, { link_preview_options: { is_disabled: true } });
      }
    }
  } catch (err) {
    if (err instanceof GeminiError) {
      if (err.code === 'NO_RECIPE') {
        const reason = err.reason ? `\n\n${err.reason}` : '';
        await editLoading(`🍽️ No recipes were found in this document.${reason}`);
      } else {
        await editLoading('⚠️ Failed to extract recipes from this document. Please try again.');
      }
    } else {
      console.error('[handler] Document processing error:', err);
      await editLoading('⚠️ An unexpected error occurred while processing the document.');
    }
  }
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
