# yt-dlp Setup

The bot uses `yt-dlp` to fetch Instagram post captions. It is already installed on your machine.

## Your current installation

yt-dlp is installed via pip at:
```
C:\Users\stavh\AppData\Local\Programs\Python\Python312\Scripts\yt-dlp.exe
```

The bot auto-detects this path using your Windows `USERNAME` environment variable — **no configuration needed**.

## Verify it works

Open a terminal and run:
```bash
yt-dlp --version
```

You should see a version number like `2024.12.06`.

If the command is not found, run:
```bash
pip install yt-dlp
```

## Keeping yt-dlp up to date

Instagram occasionally changes its internal API. If the bot suddenly stops fetching posts, update yt-dlp:

```bash
pip install --upgrade yt-dlp
# or, using yt-dlp's self-updater:
yt-dlp -U
```

## Alternative: Standalone executable

If you want yt-dlp independent of Python, install it via winget:

```bash
winget install yt-dlp.yt-dlp
```

Then add to `.env`:
```
YTDLP_PATH=yt-dlp
```

## Custom path

If yt-dlp is installed somewhere else, override the auto-detected path in `.env`:
```
YTDLP_PATH=C:\path\to\yt-dlp.exe
```
