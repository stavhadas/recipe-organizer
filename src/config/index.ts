import 'dotenv/config';
import path from 'path';
import os from 'os';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

// Auto-detect yt-dlp path installed via pip on Windows
// Falls back to 'yt-dlp' (assumes it's in PATH) on non-Windows or if USERNAME is unset
function detectYtDlpPath(): string {
  const username = process.env['USERNAME'] ?? process.env['USER'];
  if (process.platform === 'win32' && username) {
    return path.join(
      'C:\\Users',
      username,
      'AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe',
    );
  }
  return 'yt-dlp';
}

export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  },
  gemini: {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: optionalEnv('GEMINI_MODEL', 'gemini-2.5-flash'),
  },
  ytDlp: {
    binaryPath: optionalEnv('YTDLP_PATH', detectYtDlpPath()),
    timeoutMs: parseInt(optionalEnv('YTDLP_TIMEOUT_MS', '30000'), 10),
    cookiesBrowser: process.env['YTDLP_COOKIES_BROWSER'],
    cookiesFile: process.env['YTDLP_COOKIES_FILE'],
  },
  bot: {
    maxCaptionLength: parseInt(optionalEnv('MAX_CAPTION_LENGTH', '8000'), 10),
  },
  web: {
    port: parseInt(optionalEnv('WEB_PORT', '3000'), 10),
    dbPath: optionalEnv('DB_PATH', 'recipes.db'),
  },
} as const;
