import { execa } from 'execa';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config/index.js';

export interface InstagramPost {
  caption: string;
  title: string;
  uploaderName: string;
  thumbnailUrl?: string;
  canonicalUrl: string;
}

export class InstagramError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PRIVATE_POST'
      | 'NOT_FOUND'
      | 'NO_CAPTION'
      | 'RATE_LIMITED'
      | 'FETCH_FAILED',
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'InstagramError';
  }
}

// Build extra yt-dlp args for optional cookie auth
function buildAuthArgs(): string[] {
  if (config.ytDlp.cookiesBrowser) {
    return ['--cookies-from-browser', config.ytDlp.cookiesBrowser];
  }
  if (config.ytDlp.cookiesFile) {
    return ['--cookies', config.ytDlp.cookiesFile];
  }
  return [];
}

async function fetchViaYtDlp(url: string): Promise<InstagramPost> {
  const args = [
    '--dump-json',
    '--no-download',
    '--no-playlist',
    ...buildAuthArgs(),
    url,
  ];

  let stdout: string;
  try {
    const result = await execa(config.ytDlp.binaryPath, args, {
      timeout: config.ytDlp.timeoutMs,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const stderrLower = stderr.toLowerCase();

    if (
      stderrLower.includes('requires authentication') ||
      stderrLower.includes('login required') ||
      stderrLower.includes('not granting access') ||
      stderrLower.includes('checkpoint_required')
    ) {
      throw new InstagramError('Post is private or requires login', 'PRIVATE_POST', err);
    }

    if (stderrLower.includes('http error 404') || stderrLower.includes('unable to download')) {
      throw new InstagramError('Post not found', 'NOT_FOUND', err);
    }

    if (stderrLower.includes('429') || stderrLower.includes('too many requests')) {
      throw new InstagramError('Rate limited by Instagram', 'RATE_LIMITED', err);
    }

    if (stderrLower.includes('no such file or directory') && stderrLower.includes('cookies')) {
      throw new InstagramError('Cookies file not found — check the cookies_file path in add-on config', 'FETCH_FAILED', err);
    }

    if (
      stderrLower.includes('empty media response') ||
      stderrLower.includes('login') ||
      stderrLower.includes('cookies are required')
    ) {
      throw new InstagramError('Instagram requires login — provide a cookies file', 'PRIVATE_POST', err);
    }

    // Generic failure — caller will try HTTP fallback
    console.warn('[instagram] yt-dlp stderr:', stderr || '(no stderr)');
    throw new InstagramError('yt-dlp fetch failed', 'FETCH_FAILED', err);
  }

  const data = JSON.parse(stdout) as Record<string, unknown>;
  const caption = (data['description'] as string | undefined)?.trim() ?? '';

  if (!caption) {
    throw new InstagramError('Post has no caption text', 'NO_CAPTION');
  }

  return {
    caption,
    title: (data['title'] as string | undefined) ?? '',
    uploaderName: (data['uploader_id'] as string | undefined) ?? '',
    thumbnailUrl: data['thumbnail'] as string | undefined,
    canonicalUrl: (data['webpage_url'] as string | undefined) ?? url,
  };
}

async function fetchViaHttp(url: string): Promise<InstagramPost> {
  let html: string;
  try {
    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });
    html = response.data;
  } catch (err) {
    throw new InstagramError('HTTP fetch failed', 'FETCH_FAILED', err);
  }

  const $ = cheerio.load(html);
  const ogDescription = $('meta[property="og:description"]').attr('content') ?? '';
  const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';

  // og:description format: `username on Instagram: "caption text here"`
  const captionMatch = /^[^:]+:\s*[""](.+)[""]$/s.exec(ogDescription);
  const caption = (captionMatch?.[1] ?? ogDescription).trim();

  if (!caption) {
    throw new InstagramError(
      'Could not extract caption from page (may be private)',
      'PRIVATE_POST',
    );
  }

  return {
    caption,
    title: ogTitle,
    uploaderName: '',
    canonicalUrl: url,
  };
}

export async function fetchInstagramPost(url: string): Promise<InstagramPost> {
  try {
    return await fetchViaYtDlp(url);
  } catch (err) {
    // Only fall back to HTTP for generic failures — not auth/not-found errors
    if (err instanceof InstagramError && err.code === 'FETCH_FAILED') {
      console.warn('[instagram] yt-dlp failed, trying HTTP fallback');
      return await fetchViaHttp(url);
    }
    throw err;
  }
}

// Called at startup — warns if yt-dlp is missing but doesn't crash the bot
export async function verifyYtDlp(): Promise<void> {
  try {
    const result = await execa(config.ytDlp.binaryPath, ['--version'], {
      timeout: 10000,
      reject: false, // don't throw on non-zero exit
    });
    const version = result.stdout.trim() || result.stderr.trim();
    if (version) {
      console.log(`[instagram] yt-dlp verified: ${version}`);
    } else {
      console.warn(`[instagram] WARNING: yt-dlp found but returned no version output.`);
    }
  } catch {
    console.warn(
      `[instagram] WARNING: yt-dlp not found at "${config.ytDlp.binaryPath}". HTTP fallback will be used.`,
    );
  }
}
