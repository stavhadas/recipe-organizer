import { getRecipesNeedingStepIngredients, updateRecipeSteps } from '../db/database.js';
import { extractRecipe } from './gemini.js';

/**
 * Finds recipes that are missing per-step ingredient data (stored before that feature
 * was added) and re-runs Gemini extraction on their saved raw caption to fill it in.
 * Runs in the background — errors are logged but never fatal.
 */
export async function backfillStepIngredients(): Promise<void> {
  const recipes = getRecipesNeedingStepIngredients();
  if (recipes.length === 0) return;

  console.log(`[migration] ${recipes.length} recipe(s) need step-ingredient backfill — starting...`);

  for (const recipe of recipes) {
    try {
      console.log(`[migration] Refetching step ingredients for "${recipe.title}" (id=${recipe.id})`);
      const extracted = await extractRecipe(recipe._raw!);
      updateRecipeSteps(recipe.id, extracted.steps);
      console.log(`[migration] Done: "${recipe.title}"`);
    } catch (err) {
      console.error(`[migration] Failed for recipe id=${recipe.id}:`, err);
    }
  }

  console.log('[migration] Step-ingredient backfill complete.');
}
