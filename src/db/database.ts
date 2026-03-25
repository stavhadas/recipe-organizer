import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { RecipeSchema, type Recipe, type RecipeStep } from '../models/recipe.js';

const db = new Database(config.web.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    servings     TEXT,
    prep_time    TEXT,
    cook_time    TEXT,
    ingredients  TEXT NOT NULL,
    steps        TEXT NOT NULL,
    labels       TEXT,
    source_url   TEXT NOT NULL UNIQUE,
    extracted_at TEXT NOT NULL,
    raw_caption  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_title ON recipes(title COLLATE NOCASE);
`);

// Migrate existing DBs that don't have the labels column yet
try {
  db.exec(`ALTER TABLE recipes ADD COLUMN labels TEXT`);
} catch {
  // Column already exists — ignore
}

const stmtInsert = db.prepare(`
  INSERT OR REPLACE INTO recipes
    (title, description, servings, prep_time, cook_time, ingredients, steps, labels, source_url, extracted_at, raw_caption)
  VALUES
    (@title, @description, @servings, @prep_time, @cook_time, @ingredients, @steps, @labels, @source_url, @extracted_at, @raw_caption)
`);

const stmtAll = db.prepare(`SELECT * FROM recipes ORDER BY extracted_at DESC`);
const stmtById = db.prepare(`SELECT * FROM recipes WHERE id = ?`);

interface RecipeRow {
  id: number;
  title: string;
  description: string | null;
  servings: string | null;
  prep_time: string | null;
  cook_time: string | null;
  ingredients: string;
  steps: string;
  labels: string | null;
  source_url: string;
  extracted_at: string;
  raw_caption: string | null;
}

function rowToRecipe(row: RecipeRow): Recipe & { id: number } {
  const recipe = RecipeSchema.parse({
    title: row.title,
    description: row.description ?? undefined,
    servings: row.servings ?? undefined,
    prepTime: row.prep_time ?? undefined,
    cookTime: row.cook_time ?? undefined,
    ingredients: JSON.parse(row.ingredients) as unknown[],
    steps: JSON.parse(row.steps) as unknown[],
    labels: row.labels ? (JSON.parse(row.labels) as string[]) : [],
    sourceUrl: row.source_url,
    extractedAt: row.extracted_at,
    _raw: row.raw_caption ?? undefined,
  });
  return { ...recipe, id: row.id };
}

export function saveRecipe(recipe: Recipe): void {
  stmtInsert.run({
    title: recipe.title,
    description: recipe.description ?? null,
    servings: recipe.servings ?? null,
    prep_time: recipe.prepTime ?? null,
    cook_time: recipe.cookTime ?? null,
    ingredients: JSON.stringify(recipe.ingredients),
    steps: JSON.stringify(recipe.steps),
    labels: JSON.stringify(recipe.labels ?? []),
    source_url: recipe.sourceUrl,
    extracted_at: recipe.extractedAt,
    raw_caption: recipe._raw ?? null,
  });
}

export function getAllRecipes(): (Recipe & { id: number })[] {
  return (stmtAll.all() as RecipeRow[]).map(rowToRecipe);
}

export function getRecipeById(id: number): (Recipe & { id: number }) | undefined {
  const row = stmtById.get(id) as RecipeRow | undefined;
  return row ? rowToRecipe(row) : undefined;
}

/**
 * Unified search + label filter.
 * - query: case-insensitive substring match on title/description
 * - labels: AND filter — recipe must contain ALL of the given labels
 */
export function filterRecipes(query?: string, labels?: string[]): (Recipe & { id: number })[] {
  let rows = stmtAll.all() as RecipeRow[];

  if (query) {
    const lower = query.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(lower) ||
        (r.description ?? '').toLowerCase().includes(lower),
    );
  }

  if (labels && labels.length > 0) {
    rows = rows.filter((r) => {
      const rowLabels: string[] = r.labels ? (JSON.parse(r.labels) as string[]) : [];
      return labels.every((l) => rowLabels.includes(l));
    });
  }

  return rows.map(rowToRecipe);
}

/** All unique labels across all recipes, sorted case-insensitively. */
export function getAllLabels(): string[] {
  const result = db
    .prepare(
      `SELECT DISTINCT value FROM recipes, json_each(recipes.labels)
       WHERE recipes.labels IS NOT NULL AND recipes.labels != '[]'
       ORDER BY value COLLATE NOCASE`,
    )
    .all() as { value: string }[];
  return result.map((r) => r.value);
}

const stmtUpdateSteps = db.prepare(`UPDATE recipes SET steps = ? WHERE id = ?`);
const stmtUpdateLabels = db.prepare(`UPDATE recipes SET labels = ? WHERE id = ?`);

export function updateRecipeSteps(id: number, steps: RecipeStep[]): void {
  stmtUpdateSteps.run(JSON.stringify(steps), id);
}

export function updateRecipeLabels(id: number, labels: string[]): void {
  stmtUpdateLabels.run(JSON.stringify(labels), id);
}

/** Recipes with a raw caption but no labels assigned yet (for backfill). */
export function getRecipesNeedingLabels(): (Recipe & { id: number })[] {
  return getAllRecipes().filter(
    (r) => r._raw && (!r.labels || r.labels.length === 0),
  );
}

// Returns all recipes that have a raw caption but no per-step ingredient data
export function getRecipesNeedingStepIngredients(): (Recipe & { id: number })[] {
  return getAllRecipes().filter(
    (r) => r._raw && r.steps.every((s) => !s.ingredients || s.ingredients.length === 0),
  );
}
