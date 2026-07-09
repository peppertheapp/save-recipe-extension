// Local mock of the Pepper extension API (Phase 3 endpoints) for end-to-end
// testing before the real Lambdas exist. Run: npm run mock-api
// Then set the popup's "API base URL override" to http://localhost:8787
import { createServer } from 'node:http';

const PORT = 8787;
const saved = new Map(); // userId -> Map<sourceUrl, recipeId>
let nextId = 1;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/extension/verify') {
    const userId = url.searchParams.get('userId') ?? '';
    if (!userId) return json(res, 404, { valid: false });
    console.log(`[verify] ${userId}`);
    return json(res, 200, { valid: true, displayName: `${userId} (mock)`, avatarUrl: null });
  }

  if (req.method === 'POST' && url.pathname === '/v1/extension/import') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return json(res, 422, { message: 'invalid JSON' });
      }
      const { userId, recipe } = payload ?? {};
      if (!userId || !recipe?.sourceUrl || !recipe?.title) {
        return json(res, 422, { message: 'missing userId/recipe.sourceUrl/recipe.title' });
      }
      if (!saved.has(userId)) saved.set(userId, new Map());
      const userSaves = saved.get(userId);

      if (userSaves.has(recipe.sourceUrl)) {
        console.log(`[import] DUPLICATE "${recipe.title}" (${userId})`);
        return json(res, 200, { duplicate: true, recipeId: userSaves.get(recipe.sourceUrl) });
      }

      const recipeId = `rcp_mock_${nextId++}`;
      userSaves.set(recipe.sourceUrl, recipeId);
      console.log(
        `[import] SAVED "${recipe.title}" — ${recipe.ingredients?.length ?? 0} ingredients, ` +
          `${recipe.instructions?.length ?? 0} steps, method=${recipe.extractionMethod} (${userId})`,
      );
      return json(res, 201, {
        recipeId,
        profileUrl: `https://peppertheapp.com/mock/${userId}/${recipeId}`,
      });
    });
    return;
  }

  json(res, 404, { message: 'not found' });
}).listen(PORT, () => {
  console.log(`Pepper mock API listening on http://localhost:${PORT}`);
  console.log('Saves are kept in memory and reset on restart.');
});
