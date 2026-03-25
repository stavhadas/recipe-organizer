import axios from 'axios';
import * as cheerio from 'cheerio';

export interface WebPageContent {
  jsonLd?: object;   // parsed JSON-LD Recipe object if found
  text?: string;     // visible page text (fallback)
  pageTitle: string; // <title> tag
}

export class WebFetchError extends Error {
  constructor(
    message: string,
    public readonly code: 'FETCH_FAILED' | 'UNSUPPORTED_CONTENT' | 'TOO_LARGE',
  ) {
    super(message);
    this.name = 'WebFetchError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MAX_TEXT_CHARS = 12000;
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Fetch a web page and extract either JSON-LD recipe structured data
 * or visible text content for Gemini to parse.
 */
export async function fetchWebPageContent(url: string): Promise<WebPageContent> {
  let html: string;
  let contentType: string;

  try {
    const response = await axios.get<string>(url, {
      timeout: 15000,
      maxContentLength: MAX_HTML_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
      },
      responseType: 'text',
    });
    html = response.data as string;
    contentType = (response.headers['content-type'] as string | undefined) ?? '';
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED') {
      throw new WebFetchError('Page is too large', 'TOO_LARGE');
    }
    throw new WebFetchError(`Failed to fetch page: ${String(err)}`, 'FETCH_FAILED');
  }

  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new WebFetchError(`Not an HTML page (Content-Type: ${contentType})`, 'UNSUPPORTED_CONTENT');
  }

  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim();

  // --- Try JSON-LD structured data first ---
  const jsonLd = extractJsonLdRecipe($);
  if (jsonLd) {
    return { jsonLd, pageTitle };
  }

  // --- Fallback: extract visible text ---
  // Remove noise elements
  $('script, style, noscript, nav, header, footer, aside, iframe').remove();
  $('[class*="cookie"], [class*="popup"], [class*="modal"], [id*="cookie"], [id*="popup"]').remove();
  $('[class*="advert"], [class*="banner"], [class*="sidebar"]').remove();

  // Prefer semantic content elements
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.recipe',
    '.recipe-content',
    '.entry-content',
    '.post-content',
    '.article-content',
    '.content',
  ];

  let text = '';
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) {
      text = el.text();
      break;
    }
  }

  // Ultimate fallback: full body
  if (!text.trim()) {
    text = $('body').text();
  }

  // Normalise whitespace
  text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);

  if (!text) {
    throw new WebFetchError('No extractable text found on page', 'UNSUPPORTED_CONTENT');
  }

  return { text, pageTitle };
}

/**
 * Look for a Schema.org Recipe in JSON-LD script tags.
 * Handles both single objects and arrays, as well as @graph wrappers.
 */
function extractJsonLdRecipe($: cheerio.CheerioAPI): object | null {
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).html();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const recipe = findRecipeNode(parsed);
    if (recipe) return recipe;
  }

  return null;
}

function findRecipeNode(node: unknown): object | null {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  // Check @graph wrapper
  if (Array.isArray(obj['@graph'])) {
    return findRecipeNode(obj['@graph']);
  }

  // Check @type
  const type = obj['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
    return obj;
  }

  return null;
}
