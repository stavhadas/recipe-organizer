import express, { type Request, type Response } from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { filterRecipes, getAllLabels, getRecipeById } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../..', 'public');

// Serve an HTML file with the HA ingress base path injected.
// Standalone (no ingress): X-Ingress-Path is absent → BASE = ''
// Under HA ingress:        X-Ingress-Path = '/api/hassio_ingress/{token}' → injected into HTML
function serveHtml(filename: string) {
  const template = readFileSync(path.join(publicDir, filename), 'utf8');
  return (req: Request, res: Response) => {
    const basePath = (req.headers['x-ingress-path'] as string | undefined) ?? '';
    res.type('html').send(template.replace(/__BASE_PATH__/g, basePath));
  };
}

export function startWebServer(): void {
  const app = express();

  // ── API routes ─────────────────────────────────────────────────────────────

  app.get('/api/recipes', (req, res) => {
    try {
      const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : undefined;
      const labelsParam = typeof req.query['labels'] === 'string' ? req.query['labels'].trim() : undefined;
      const labels = labelsParam ? labelsParam.split(',').map((l) => l.trim()).filter(Boolean) : undefined;
      res.json(filterRecipes(q || undefined, labels));
    } catch (err) {
      console.error('[web] GET /api/recipes error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/labels', (_req, res) => {
    try {
      res.json(getAllLabels());
    } catch (err) {
      console.error('[web] GET /api/labels error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/recipes/:id', (req, res) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    try {
      const recipe = getRecipeById(id);
      if (!recipe) { res.status(404).json({ error: 'Recipe not found' }); return; }
      res.json(recipe);
    } catch (err) {
      console.error('[web] GET /api/recipes/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── HTML pages (with base-path injection) ──────────────────────────────────

  app.get('/', serveHtml('index.html'));
  app.get('/recipes/:id', serveHtml('recipe.html'));

  // ── Static assets (JS, CSS, fonts, images) ─────────────────────────────────

  app.use(express.static(publicDir));

  app.listen(config.web.port, () => {
    console.log(`[web] Recipe Vault running at http://localhost:${config.web.port}`);
  });
}
