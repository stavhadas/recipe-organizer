import type { Recipe } from '../models/recipe.js';

// Telegram supports a limited HTML subset: <b>, <i>, <u>, <s>, <code>, <pre>, <a>
// We must escape &, <, > in all user-provided strings
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatIngredient(ing: Recipe['ingredients'][number]): string {
  const amount = ing.amount ? `${esc(ing.amount)} ` : '';
  const unit = ing.unit ? `${esc(ing.unit)} ` : '';
  const notes = ing.notes ? ` <i>(${esc(ing.notes)})</i>` : '';
  return `• ${amount}${unit}${esc(ing.name)}${notes}`;
}

function formatStep(step: Recipe['steps'][number]): string {
  const duration = step.duration ? ` <i>(${esc(step.duration)})</i>` : '';
  return `<b>${step.step}.</b> ${esc(step.instruction)}${duration}`;
}

export function formatRecipeAsHtml(recipe: Recipe): string {
  const lines: string[] = [];

  if (recipe.aiCompleted) {
    lines.push(`<i>⚠️ This recipe was brief or incomplete in the original document. It has been expanded by AI and may differ from the original.</i>`);
    lines.push('');
  }

  lines.push(`<b>${esc(recipe.title)}</b>`);

  if (recipe.description) {
    lines.push(`<i>${esc(recipe.description)}</i>`);
  }

  lines.push('');

  // Metadata row
  const meta: string[] = [];
  if (recipe.servings) meta.push(`Serves: ${esc(recipe.servings)}`);
  if (recipe.prepTime) meta.push(`Prep: ${esc(recipe.prepTime)}`);
  if (recipe.cookTime) meta.push(`Cook: ${esc(recipe.cookTime)}`);
  if (meta.length > 0) lines.push(meta.join(' | '));

  lines.push('');
  lines.push('<b>Ingredients</b>');
  for (const ing of recipe.ingredients) {
    lines.push(formatIngredient(ing));
  }

  lines.push('');
  lines.push('<b>Instructions</b>');
  for (const step of recipe.steps) {
    lines.push(formatStep(step));
  }

  if (!recipe.sourceUrl.startsWith('doc://')) {
    lines.push('');
    lines.push(`<a href="${esc(recipe.sourceUrl)}">View original post ↗</a>`);
  }

  return lines.join('\n');
}

// Splits a long HTML message into chunks ≤ maxLen chars, splitting on blank lines
export function splitHtmlMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of text.split('\n\n')) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
