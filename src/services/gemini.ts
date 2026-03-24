import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { GeminiRecipeOutputSchema, type GeminiRecipeOutput } from '../models/recipe.js';

const genAI = new GoogleGenAI({ apiKey: config.gemini.apiKey });

const SYSTEM_INSTRUCTION = `You are a recipe extraction assistant. Your job is to read social media post captions and produce a clean, well-structured recipe.

Rules:
- The caption may be in any language (Hebrew, Arabic, Spanish, etc.). Extract and return the recipe in the same language as the caption.
- Use your judgment to identify and organize ingredients and steps even if the caption is loosely written, uses casual language, or mixes instructions with storytelling.
- Infer reasonable structure: if ingredients are listed inline within a sentence, split them out. If steps are described narratively, convert them to clear numbered instructions.
- Omit amounts and units only when truly absent — do not guess specific measurements, but do include vague ones like "a handful", "to taste", "a drizzle".
- Clean up hashtags (#...), mentions (@...), and promotional text.
- Steps must be numbered sequentially starting from 1.
- For each step, include an "ingredients" array listing the ingredients added or used in that step. Each entry has "name" (exact name from the ingredients list above) and, if determinable, "amount" and "unit" for the quantity used specifically in that step — which may differ from the total amount in the ingredients list. Use your language understanding to infer what's being added at each step. Omit the field entirely if no specific ingredient is added in that step.
- If the post genuinely contains no food recipe at all, return exactly: {"error": "No recipe found", "reason": "<brief explanation>"}.
- Do NOT include any text outside the JSON object.`;

const RECIPE_JSON_SCHEMA = `{
  "title": "string — recipe name (infer from context if not stated)",
  "description": "string — optional 1-2 sentence summary",
  "servings": "string — optional, e.g. '4 servings' or 'makes 12 cookies'",
  "prepTime": "string — optional, e.g. '15 min'",
  "cookTime": "string — optional, e.g. '30 min'",
  "ingredients": [
    {
      "name": "string",
      "amount": "string — optional, omit if truly unknown",
      "unit": "string — optional",
      "notes": "string — optional, e.g. 'finely chopped'"
    }
  ],
  "steps": [
    {
      "step": "number",
      "instruction": "string",
      "duration": "string — optional, e.g. '5 minutes'",
      "ingredients": [
        {
          "name": "string — exact ingredient name from the ingredients list",
          "amount": "string — optional, quantity used in THIS step specifically",
          "unit": "string — optional"
        }
      ]
    }
  ]
}`;

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_RECIPE' | 'INVALID_RESPONSE' | 'API_ERROR',
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

async function callGemini(prompt: string): Promise<string> {
  try {
    const response = await genAI.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    });
    return response.text ?? '';
  } catch (err) {
    console.error('[gemini] API call failed:', err);
    throw new GeminiError(`Gemini API call failed: ${err}`, 'API_ERROR');
  }
}

export async function extractRecipe(caption: string): Promise<GeminiRecipeOutput> {
  console.log('[gemini] Caption received:\n---\n' + caption + '\n---');
  const truncated = caption.slice(0, config.bot.maxCaptionLength);

  const prompt = `Extract the recipe from this Instagram post caption. Return ONLY valid JSON matching this schema:

${RECIPE_JSON_SCHEMA}

If no recipe is present, return: {"error": "No recipe found", "reason": "..."}

Caption:
---
${truncated}
---`;

  const rawJson = await callGemini(prompt);
  console.log('[gemini] Raw response:\n---\n' + rawJson + '\n---');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new GeminiError('Gemini returned invalid JSON', 'INVALID_RESPONSE');
  }

  // Gemini signalled no recipe
  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    const { reason } = parsed as { error: string; reason?: string };
    throw new GeminiError('No recipe found in caption', 'NO_RECIPE', reason);
  }

  // Validate with Zod
  const result = GeminiRecipeOutputSchema.safeParse(parsed);
  if (result.success) return result.data;

  console.log('[gemini] Zod validation errors:', JSON.stringify(result.error.issues, null, 2));

  // One repair attempt: tell Gemini what was wrong
  const errors = result.error.issues
    .map((e) => `- ${String(e.path.join('.'))}: ${e.message}`)
    .join('\n');

  const repairPrompt = `The JSON you returned has these validation errors:
${errors}

Return the corrected JSON only, keeping the same schema. Your previous response:
${rawJson}`;

  const repairedJson = await callGemini(repairPrompt);

  let repaired: unknown;
  try {
    repaired = JSON.parse(repairedJson);
  } catch {
    throw new GeminiError('Gemini repair response was not valid JSON', 'INVALID_RESPONSE');
  }

  const repairResult = GeminiRecipeOutputSchema.safeParse(repaired);
  if (!repairResult.success) {
    throw new GeminiError(
      'Recipe extraction produced invalid structure after repair attempt',
      'INVALID_RESPONSE',
    );
  }

  return repairResult.data;
}
