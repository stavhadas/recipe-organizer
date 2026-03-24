import { z } from 'zod';

// nullish() = optional + nullable — handles both undefined and null from Gemini
export const IngredientSchema = z.object({
  name: z.string().min(1),
  amount: z.string().nullish(),
  unit: z.string().nullish(),
  notes: z.string().nullish(),
});

export const RecipeStepSchema = z.object({
  step: z.number().int().positive(),
  instruction: z.string().min(1),
  duration: z.string().nullish(),
});

export const RecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  servings: z.string().nullish(),
  prepTime: z.string().nullish(),
  cookTime: z.string().nullish(),
  ingredients: z.array(IngredientSchema).min(1),
  steps: z.array(RecipeStepSchema).min(1),
  sourceUrl: z.string().url(),
  extractedAt: z.string().datetime(),
  _raw: z.string().nullish(),
});

// Schema for what Gemini returns — no metadata fields (added by the caller)
export const GeminiRecipeOutputSchema = RecipeSchema.omit({
  sourceUrl: true,
  extractedAt: true,
  _raw: true,
});

export type Ingredient = z.infer<typeof IngredientSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type GeminiRecipeOutput = z.infer<typeof GeminiRecipeOutputSchema>;
