import crypto from 'crypto';
import type { Context } from 'telegraf';
import axios from 'axios';
import { isInstagramUrl, normalizeInstagramUrl, extractTextUrls } from '../utils/urlParser.js';
import { fetchInstagramPost, InstagramError } from '../services/instagram.js';
import { extractRecipe, extractRecipesFromDocument, extractRecipeFromWebContent, generateErrorExplanation, GeminiError } from '../services/gemini.js';
import { fetchWebPageContent, WebFetchError } from '../services/webFetcher.js';
import { formatRecipeAsHtml, splitHtmlMessage } from '../services/formatter.js';
import { RecipeSchema } from '../models/recipe.js';
import { saveRecipe } from '../db/database.js';
import { extractDocxText } from '../services/documentParser.js';

const SUPPORTED_MIME_TYPES: Record<string, 'pdf' | 'docx'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

async function resolveUserMessage(err: unknown, source?: string): Promise<string> {
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

  if (err instanceof WebFetchError) {
    switch (err.code) {
      case 'FETCH_FAILED':
        return '⚠️ Could not reach that page. Check the URL and try again.';
      case 'UNSUPPORTED_CONTENT':
        return '❌ That URL doesn\'t point to a readable web page. Please send a recipe page URL.';
      case 'TOO_LARGE':
        return '❌ That page is too large to process.';
    }
  }

  if (err instanceof GeminiError) {
    if (err.code === 'NO_RECIPE') {
      const reason = err.reason ? `\n\n${err.reason}` : '';
      return `🍽️ No recipe was found.${reason}`;
    }

    // For extraction failures, ask AI to give a meaningful explanation
    const aiExplanation = await generateErrorExplanation({
      source: source ?? 'a recipe source',
      error: err.message,
      hint: err.code === 'INVALID_RESPONSE'
        ? 'The content structure was unusual and could not be parsed into a valid recipe format after multiple attempts.'
        : undefined,
    });

    const fallback = '⚠️ Failed to extract the recipe. The content may be in an unusual format.';
    return aiExplanation ? `⚠️ ${aiExplanation}` : fallback;
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
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        undefined,
        text,
        { parse_mode: 'HTML' },
      );
    } catch {
      // ignore edit failures (e.g. message already deleted)
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
        await editLoading(`🍽️ לא נמצאו מתכונים במסמך זה.${reason}`);
      } else {
        const aiExplanation = await generateErrorExplanation({
          source: `a ${fileType === 'pdf' ? 'PDF' : 'Word'} document named "${filename}"`,
          error: err.message,
          hint: err.code === 'INVALID_RESPONSE'
            ? 'The document may be structured as class notes or a course guide rather than a recipe collection, which makes it harder to extract standardised recipe data.'
            : undefined,
        });
        const base = '⚠️ Failed to extract recipes from this document.';
        await editLoading(aiExplanation ? `${base}\n\n${aiExplanation}` : base);
      }
    } else {
      console.error('[handler] Document processing error:', err);
      const aiExplanation = await generateErrorExplanation({
        source: `a ${fileType === 'pdf' ? 'PDF' : 'Word'} document named "${filename}"`,
        error: String(err),
      });
      const base = '⚠️ An unexpected error occurred while processing the document.';
      await editLoading(aiExplanation ? `${base}\n\n${aiExplanation}` : base);
    }
  }
}

export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text;
  const allUrls = extractTextUrls(text);
  const igUrl = allUrls.find(isInstagramUrl);
  const webUrl = !igUrl ? allUrls[0] : undefined;

  if (!igUrl && !webUrl) {
    // Silently ignore non-URL messages; give a hint if it looks like a failed URL
    if (text.startsWith('http')) {
      await ctx.reply('Please send a recipe page URL or an Instagram post URL.');
    }
    return;
  }

  if (igUrl) {
    await handleInstagramUrl(ctx, normalizeInstagramUrl(igUrl));
  } else {
    await handleWebUrl(ctx, webUrl!);
  }
}

async function handleInstagramUrl(ctx: Context, url: string): Promise<void> {
  const loadingMsg = await ctx.replyWithHTML(
    `⏳ Fetching recipe...\n<code>${url}</code>`,
    { link_preview_options: { is_disabled: true } },
  );

  const editLoading = async (msg: string) => {
    await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, msg);
  };

  try {
    const post = await fetchInstagramPost(url);
    const extracted = await extractRecipe(post.caption);
    const recipe = RecipeSchema.parse({
      ...extracted,
      sourceUrl: url,
      extractedAt: new Date().toISOString(),
      _raw: post.caption,
    });

    try {
      saveRecipe(recipe);
    } catch (dbErr) {
      console.error('[handler] DB save failed:', dbErr);
    }

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
      await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk, { link_preview_options: { is_disabled: true } });
      }
    }
  } catch (err) {
    await editLoading(await resolveUserMessage(err, `an Instagram post at ${url}`));
  }
}

async function handleWebUrl(ctx: Context, url: string): Promise<void> {
  const loadingMsg = await ctx.replyWithHTML(
    `⏳ Fetching recipe...\n<code>${url}</code>`,
    { link_preview_options: { is_disabled: true } },
  );

  const editLoading = async (msg: string) => {
    await ctx.telegram.editMessageText(ctx.chat!.id, loadingMsg.message_id, undefined, msg);
  };

  try {
    const content = await fetchWebPageContent(url);
    const extracted = await extractRecipeFromWebContent(content);
    const recipe = RecipeSchema.parse({
      ...extracted,
      sourceUrl: url,
      extractedAt: new Date().toISOString(),
      _raw: content.text ?? JSON.stringify(content.jsonLd),
    });

    try {
      saveRecipe(recipe);
    } catch (dbErr) {
      console.error('[handler] DB save failed:', dbErr);
    }

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
      await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
      for (const chunk of chunks) {
        await ctx.replyWithHTML(chunk, { link_preview_options: { is_disabled: true } });
      }
    }
  } catch (err) {
    await editLoading(await resolveUserMessage(err, `a recipe page at ${url}`));
  }
}
