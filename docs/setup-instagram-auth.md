# Instagram Authentication (Optional)

By default the bot fetches public Instagram posts without any login. However, Instagram may occasionally rate-limit anonymous requests or block access. If you see errors like "Post is private" for posts that are actually public, or "Rate limited", adding cookie authentication fixes this.

## When do you need this?

- You see "Post is private" errors on public posts
- You see "Rate limited" errors frequently
- You want to fetch posts from accounts you follow (requires login)

## Option A — Cookies from your browser (recommended)

This uses your existing Instagram login from Chrome/Edge/Firefox.

### Setup

Add to `.env`:
```
YTDLP_COOKIES_BROWSER=chrome
```

Replace `chrome` with `firefox`, `edge`, `brave`, or `opera` if you use a different browser.

### How it works

yt-dlp reads the Instagram cookies directly from your browser's cookie store — no password needed. You just need to be logged in to Instagram in that browser.

## Option B — Export a cookies.txt file

If Option A doesn't work, export cookies manually:

### Setup

1. Install the **"Get cookies.txt LOCALLY"** extension in Chrome (or similar for your browser)
2. Log in to Instagram in that browser
3. Visit `https://www.instagram.com`
4. Click the extension icon and export cookies — save as `cookies.txt` in the project root
5. Add to `.env`:
   ```
   YTDLP_COOKIES_FILE=cookies.txt
   ```

> **Note:** `cookies.txt` is listed in `.gitignore` so it will not be committed to git.

## Security recommendation

Using your personal Instagram account carries a small ban risk. For a bot used regularly, consider creating a **dedicated "burner" Instagram account** just for this purpose.

## Troubleshooting

If authentication still fails, test yt-dlp directly in the terminal:

```bash
# Test with browser cookies
yt-dlp --cookies-from-browser chrome --dump-json "https://www.instagram.com/p/SHORTCODE/"

# Test with cookies.txt
yt-dlp --cookies cookies.txt --dump-json "https://www.instagram.com/p/SHORTCODE/"
```

Replace `SHORTCODE` with a real Instagram post shortcode to test.
