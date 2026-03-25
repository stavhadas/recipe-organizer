import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from '../config/index.js';
import { GeminiRecipeOutputSchema, type GeminiRecipeOutput } from '../models/recipe.js';
import type { WebPageContent } from './webFetcher.js';

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
- Assign 2–8 labels from the taxonomy below (use exact casing). Choose only labels that clearly apply.
  Meal type:  breakfast, lunch, dinner, brunch, snack, dessert, drink
  Dietary:    vegan, vegetarian, gluten-free, dairy-free, healthy, keto
  Protein:    chicken, beef, lamb, fish, seafood, tofu, eggs, turkey, pork
  Cuisine:    asian, italian, mexican, mediterranean, middle-eastern, american, french, indian, thai, japanese
  Occasion:   passover, holiday, shabbat, quick, easy, hard, meal-prep
  Style:      soup, salad, baked, grilled, fried, raw, one-pot, pasta
  You may add 1-2 custom labels if none from the taxonomy fit well.
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
  ],
  "labels": ["string — 2-8 labels from the taxonomy"]
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

const DOCUMENT_SYSTEM_INSTRUCTION = `You are a recipe extraction assistant. You will receive a document (PDF or text) that may contain one or more recipes, and possibly non-recipe content (stories, tips, shopping lists, index pages, etc.). Extract ONLY the food recipes.

Rules:
- Return ALL recipes found in the document as an array.
- For each recipe that is complete and well-described: set "aiCompleted": false.
- For each recipe that is brief, incomplete, or missing key information (amounts, steps, temperatures, times): complete it using your culinary knowledge so it becomes a fully usable recipe, and set "aiCompleted": true. Keep the spirit, name, and main ingredients of the original — only fill in what is missing.
- The caption may be in any language (Hebrew, Arabic, Spanish, etc.). Extract and return each recipe in the same language as the source text.
- Use your judgment to identify and organize ingredients and steps even if casually written.
- Omit amounts and units only when truly absent — do not guess specific measurements, but do include vague ones like "a handful", "to taste", "a drizzle".
- Clean up page numbers, headers, footers, and non-recipe text.
- Steps must be numbered sequentially starting from 1.
- For each step, include an "ingredients" array listing the ingredients added or used in that step with amounts where determinable.
- Assign 2–8 labels from the taxonomy below (use exact casing).
  Meal type:  breakfast, lunch, dinner, brunch, snack, dessert, drink
  Dietary:    vegan, vegetarian, gluten-free, dairy-free, healthy, keto
  Protein:    chicken, beef, lamb, fish, seafood, tofu, eggs, turkey, pork
  Cuisine:    asian, italian, mexican, mediterranean, middle-eastern, american, french, indian, thai, japanese
  Occasion:   passover, holiday, shabbat, quick, easy, hard, meal-prep
  Style:      soup, salad, baked, grilled, fried, raw, one-pot, pasta
  You may add 1-2 custom labels if none from the taxonomy fit well.
- If no food recipes are found at all, return: {"error": "No recipes found", "reason": "<brief explanation>"}.
- Do NOT include any text outside the JSON object.`;

const DOCUMENT_RECIPES_JSON_SCHEMA = `{
  "recipes": [
    {
      "title": "string — recipe name",
      "description": "string — optional 1-2 sentence summary",
      "servings": "string — optional",
      "prepTime": "string — optional",
      "cookTime": "string — optional",
      "aiCompleted": "boolean — true if recipe was brief/incomplete and expanded by AI, false if original was complete",
      "ingredients": [
        {
          "name": "string",
          "amount": "string — optional",
          "unit": "string — optional",
          "notes": "string — optional"
        }
      ],
      "steps": [
        {
          "step": "number",
          "instruction": "string",
          "duration": "string — optional",
          "ingredients": [
            {
              "name": "string",
              "amount": "string — optional",
              "unit": "string — optional"
            }
          ]
        }
      ],
      "labels": ["string — 2-8 labels from the taxonomy"]
    }
  ]
}`;

const GeminiDocumentOutputSchema = z.object({
  recipes: z.array(GeminiRecipeOutputSchema),
});

export async function extractRecipesFromDocument(input: {
  pdf?: Buffer;
  text?: string;
  filename: string;
}): Promise<GeminiRecipeOutput[]> {
  const prompt = `Extract all food recipes from this document. Return ONLY valid JSON matching this schema:

${DOCUMENT_RECIPES_JSON_SCHEMA}

If no food recipes are found, return: {"error": "No recipes found", "reason": "..."}`;

  console.log(`[gemini] extractRecipesFromDocument: ${input.filename}`);

  let rawJson: string;
  try {
    let response;
    if (input.pdf) {
      response = await genAI.models.generateContent({
        model: config.gemini.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: input.pdf.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          systemInstruction: DOCUMENT_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 65536,
        },
      });
    } else {
      const textPrompt = `${prompt}\n\nDocument content:\n---\n${input.text}\n---`;
      response = await genAI.models.generateContent({
        model: config.gemini.model,
        contents: textPrompt,
        config: {
          systemInstruction: DOCUMENT_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 65536,
        },
      });
    }
    rawJson = response.text ?? '';
  } catch (err) {
    console.error('[gemini] extractRecipesFromDocument API call failed:', err);
    throw new GeminiError(`Gemini API call failed: ${err}`, 'API_ERROR');
  }

  console.log('[gemini] extractRecipesFromDocument raw response length:', rawJson.length);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new GeminiError('Gemini returned invalid JSON for document', 'INVALID_RESPONSE');
  }

  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    const { reason } = parsed as { error: string; reason?: string };
    throw new GeminiError('No recipes found in document', 'NO_RECIPE', reason);
  }

  // Resilient per-recipe validation: collect valid recipes, skip invalid ones.
  // This handles documents like class notes where some entries are too brief to
  // form a valid recipe even after AI completion.
  const tryExtractValidRecipes = (candidate: unknown): GeminiRecipeOutput[] | null => {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const rawList = (candidate as Record<string, unknown>).recipes;
    if (!Array.isArray(rawList)) return null;

    const valid: GeminiRecipeOutput[] = [];
    let skipped = 0;
    for (const r of rawList) {
      const res = GeminiRecipeOutputSchema.safeParse(r);
      if (res.success) {
        valid.push(res.data);
      } else {
        skipped++;
        console.log('[gemini] Skipping invalid recipe item:', JSON.stringify(res.error.issues));
      }
    }
    if (valid.length > 0) {
      if (skipped > 0) {
        console.log(`[gemini] Partial success: ${valid.length} valid, ${skipped} skipped`);
      }
      return valid;
    }
    return null; // all failed
  };

  const firstPass = tryExtractValidRecipes(parsed);
  if (firstPass) return firstPass;

  // All recipes failed validation — log and attempt repair
  const result = GeminiDocumentOutputSchema.safeParse(parsed);
  console.log('[gemini] document Zod validation errors:', JSON.stringify(result.error?.issues, null, 2));

  const errors = (result.error?.issues ?? [])
    .map((e) => `- ${String(e.path.join('.'))}: ${e.message}`)
    .join('\n');

  const repairPrompt = `The JSON you returned has these validation errors:
${errors}

Return the corrected JSON only, keeping the same schema. Your previous response:
${rawJson}`;

  let repairedJson: string;
  try {
    const repairResponse = await genAI.models.generateContent({
      model: config.gemini.model,
      contents: repairPrompt,
      config: {
        systemInstruction: DOCUMENT_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 65536,
      },
    });
    repairedJson = repairResponse.text ?? '';
  } catch (err) {
    throw new GeminiError(`Gemini repair call failed: ${err}`, 'API_ERROR');
  }

  let repaired: unknown;
  try {
    repaired = JSON.parse(repairedJson);
  } catch {
    throw new GeminiError('Gemini repair response was not valid JSON', 'INVALID_RESPONSE');
  }

  // Try resilient validation on repaired response too
  const repairPass = tryExtractValidRecipes(repaired);
  if (repairPass) return repairPass;

  throw new GeminiError(
    'Document recipe extraction produced invalid structure after repair attempt',
    'INVALID_RESPONSE',
  );
}

const WEB_SYSTEM_INSTRUCTION = `You are a recipe extraction assistant. Your job is to read web page content and produce a clean, well-structured recipe.

Rules:
- The page may contain ads, navigation menus, comments, related articles, and other non-recipe content. Ignore all of that — focus only on the recipe.
- The content may be in any language (Hebrew, Arabic, Spanish, etc.). Extract and return the recipe in the same language as the source.
- Use your judgment to identify and organize ingredients and steps even if the content is loosely written or mixes instructions with storytelling.
- Infer reasonable structure: if ingredients are listed inline within a sentence, split them out. If steps are described narratively, convert them to clear numbered instructions.
- Omit amounts and units only when truly absent — do not guess specific measurements, but do include vague ones like "a handful", "to taste", "a drizzle".
- Steps must be numbered sequentially starting from 1.
- For each step, include an "ingredients" array listing the ingredients added or used in that step. Each entry has "name" (exact name from the ingredients list above) and, if determinable, "amount" and "unit" for the quantity used specifically in that step.
- Assign 2–8 labels from the taxonomy below (use exact casing). Choose only labels that clearly apply.
  Meal type:  breakfast, lunch, dinner, brunch, snack, dessert, drink
  Dietary:    vegan, vegetarian, gluten-free, dairy-free, healthy, keto
  Protein:    chicken, beef, lamb, fish, seafood, tofu, eggs, turkey, pork
  Cuisine:    asian, italian, mexican, mediterranean, middle-eastern, american, french, indian, thai, japanese
  Occasion:   passover, holiday, shabbat, quick, easy, hard, meal-prep
  Style:      soup, salad, baked, grilled, fried, raw, one-pot, pasta
  You may add 1-2 custom labels if none from the taxonomy fit well.
- If the page genuinely contains no food recipe at all, return exactly: {"error": "No recipe found", "reason": "<brief explanation>"}.
- Do NOT include any text outside the JSON object.`;

export async function extractRecipeFromWebContent(
  content: WebPageContent,
): Promise<GeminiRecipeOutput> {
  let prompt: string;

  if (content.jsonLd) {
    prompt = `Convert this structured JSON-LD recipe data to our schema. Return ONLY valid JSON matching this schema:

${RECIPE_JSON_SCHEMA}

If this is not actually a recipe, return: {"error": "No recipe found", "reason": "..."}

JSON-LD data:
${JSON.stringify(content.jsonLd, null, 2)}`;
  } else {
    prompt = `Extract the recipe from this web page content. Return ONLY valid JSON matching this schema:

${RECIPE_JSON_SCHEMA}

If no recipe is present, return: {"error": "No recipe found", "reason": "..."}

Page title: ${content.pageTitle}

Page content:
---
${content.text}
---`;
  }

  console.log(`[gemini] extractRecipeFromWebContent: jsonLd=${!!content.jsonLd}, textLen=${content.text?.length ?? 0}`);

  const rawJson = await (async () => {
    try {
      const response = await genAI.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
        config: {
          systemInstruction: WEB_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      });
      return response.text ?? '';
    } catch (err) {
      console.error('[gemini] extractRecipeFromWebContent API call failed:', err);
      throw new GeminiError(`Gemini API call failed: ${err}`, 'API_ERROR');
    }
  })();

  console.log('[gemini] extractRecipeFromWebContent raw response length:', rawJson.length);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new GeminiError('Gemini returned invalid JSON for web content', 'INVALID_RESPONSE');
  }

  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    const { reason } = parsed as { error: string; reason?: string };
    throw new GeminiError('No recipe found on page', 'NO_RECIPE', reason);
  }

  const result = GeminiRecipeOutputSchema.safeParse(parsed);
  if (result.success) return result.data;

  console.log('[gemini] web Zod validation errors:', JSON.stringify(result.error.issues, null, 2));

  // One repair attempt
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
      'Web recipe extraction produced invalid structure after repair attempt',
      'INVALID_RESPONSE',
    );
  }

  return repairResult.data;
}

/**
 * Ask Gemini to generate a helpful, user-friendly explanation of why an
 * extraction failed. The reply language matches the source language hint.
 * Non-fatal: returns empty string on any failure.
 */
export async function generateErrorExplanation(context: {
  /** Human-readable description of what was sent, e.g. "a PDF cooking class document in Hebrew" */
  source: string;
  /** Technical description of the error */
  error: string;
  /** Optional extra context about what was detected */
  hint?: string;
}): Promise<string> {
  const prompt = `A user submitted ${context.source} to a recipe extraction bot, but the extraction failed.
Technical reason: ${context.error}
${context.hint ? `Additional context: ${context.hint}` : ''}

Write a helpful, specific, and warm explanation for the user (2–4 sentences) that:
1. Explains what likely went wrong in plain language (no technical jargon or internal system details)
2. Suggests what the user could try next (e.g. try a different format, simplify the document, send individual recipes)
3. If relevant, mentions anything positive that was detected (e.g. "I could see the document contained cooking tips, but...")

If the source document seems to be in Hebrew, reply in Hebrew. Otherwise reply in English.`;

  try {
    const response = await genAI.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 512 },
    });
    return (response.text ?? '').trim();
  } catch (err) {
    console.error('[gemini] generateErrorExplanation failed:', err);
    return '';
  }
}

const LABEL_TAXONOMY = `Meal type: breakfast, lunch, dinner, brunch, snack, dessert, drink
Dietary: vegan, vegetarian, gluten-free, dairy-free, healthy, keto
Protein: chicken, beef, lamb, fish, seafood, tofu, eggs, turkey, pork
Cuisine: asian, italian, mexican, mediterranean, middle-eastern, american, french, indian, thai, japanese
Occasion: passover, holiday, shabbat, quick, easy, hard, meal-prep
Style: soup, salad, baked, grilled, fried, raw, one-pot, pasta`;

/**
 * Lightweight Gemini call that returns ONLY labels for an existing recipe.
 * Used to backfill old recipes that were saved before auto-labeling was added.
 */
export async function getLabelsForRecipe(
  title: string,
  rawCaption: string,
  ingredientNames: string[],
): Promise<string[]> {
  const KNOWN_LABELS = ['breakfast','lunch','dinner','brunch','snack','dessert','drink',
    'vegan','vegetarian','gluten-free','dairy-free','healthy','keto',
    'chicken','beef','lamb','fish','seafood','tofu','eggs','turkey','pork',
    'asian','italian','mexican','mediterranean','middle-eastern','american',
    'french','indian','thai','japanese','passover','holiday','shabbat',
    'quick','easy','hard','meal-prep','soup','salad','baked','grilled',
    'fried','raw','one-pot','pasta'];

  const prompt = `You are a recipe classifier. Pick 2-8 labels for this recipe from the list below.
Reply with ONLY the chosen labels separated by commas. No other text.

Available labels: ${KNOWN_LABELS.join(', ')}

Recipe title: ${title}
Ingredients: ${ingredientNames.join(', ')}
Caption: ${rawCaption.slice(0, 1500)}`;

  try {
    const response = await genAI.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: { temperature: 0.1, maxOutputTokens: 128 },
    });
    const raw = (response.text ?? '').trim();
    console.log('[gemini] getLabelsForRecipe raw >>>' + raw + '<<<');

    // Match every word/phrase in the response against our known taxonomy
    const lower = raw.toLowerCase();
    const labels = KNOWN_LABELS.filter((w) => {
      // match as a whole word/phrase (surrounded by non-alphanumeric or start/end)
      const escaped = w.replace(/[-]/g, '\\-');
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(lower);
    });

    console.log('[gemini] getLabelsForRecipe parsed:', labels);
    return labels;
  } catch (err) {
    console.error('[gemini] getLabelsForRecipe failed:', err);
    return [];
  }
}
