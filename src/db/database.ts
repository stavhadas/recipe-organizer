import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { RecipeSchema, type Recipe } from '../models/recipe.js';

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
    source_url   TEXT NOT NULL UNIQUE,
    extracted_at TEXT NOT NULL,
    raw_caption  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_title ON recipes(title COLLATE NOCASE);
`);

const stmtInsert = db.prepare(`
  INSERT OR REPLACE INTO recipes
    (title, description, servings, prep_time, cook_time, ingredients, steps, source_url, extracted_at, raw_caption)
  VALUES
    (@title, @description, @servings, @prep_time, @cook_time, @ingredients, @steps, @source_url, @extracted_at, @raw_caption)
`);

const stmtAll = db.prepare(`SELECT * FROM recipes ORDER BY extracted_at DESC`);
const stmtById = db.prepare(`SELECT * FROM recipes WHERE id = ?`);
const stmtSearch = db.prepare(`
  SELECT * FROM recipes
  WHERE title LIKE ? OR description LIKE ?
  ORDER BY extracted_at DESC
`);

interface RecipeRow {
  id: number;
  title: string;
  description: string | null;
  servings: string | null;
  prep_time: string | null;
  cook_time: string | null;
  ingredients: string;
  steps: string;
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

export function searchRecipes(query: string): (Recipe & { id: number })[] {
  const like = `%${query}%`;
  return (stmtSearch.all(like, like) as RecipeRow[]).map(rowToRecipe);
}
