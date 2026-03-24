# Setting Up the Gemini API Key

The bot uses Google Gemini 1.5 Flash to extract recipe information from Instagram captions. The free tier is more than sufficient for personal use.

## Step 1 — Get an API key

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account
3. Click **"Create API key"**
4. Select an existing Google Cloud project, or create a new one (a free project works fine)
5. Copy the key — it starts with `AIza...`

## Step 2 — Add the key to your project

Add it to your `.env` file:

```
GEMINI_API_KEY=AIzaSyYour_Key_Here
```

## Free Tier Limits (as of 2026)

| Model | Requests/min | Tokens/day |
|---|---|---|
| Gemini 1.5 Flash | 15 | 1,000,000 |

For a personal recipe bot, you will not hit these limits.

## Notes

- No credit card is required for the free tier.
- If you ever need more capacity, you can switch to Gemini 1.5 Pro by setting `GEMINI_MODEL=gemini-1.5-pro` in `.env`.
- Keep your API key secret — do not commit `.env` to git.
