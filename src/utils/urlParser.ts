// Matches Instagram post, reel, and IGTV URLs:
//   https://www.instagram.com/p/<shortcode>/
//   https://www.instagram.com/reel/<shortcode>/
//   https://www.instagram.com/tv/<shortcode>/
//   https://instagram.com/...  (no www)
//   with or without trailing slash, with or without query params
const INSTAGRAM_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/;

export function isInstagramUrl(url: string): boolean {
  return INSTAGRAM_PATTERN.test(url);
}

export function normalizeInstagramUrl(url: string): string {
  const match = INSTAGRAM_PATTERN.exec(url);
  if (!match) throw new Error(`Not a valid Instagram URL: ${url}`);
  const type = match[1]!;
  const shortcode = match[2]!;
  return `https://www.instagram.com/${type}/${shortcode}/`;
}

// Extracts all http(s) URLs from a block of text
export function extractTextUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s]+/gi;
  return text.match(urlPattern) ?? [];
}
