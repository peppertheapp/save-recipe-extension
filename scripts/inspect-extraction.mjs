// Runs the REAL detector against a saved HTML file via jsdom and prints the
// 7 fields we care about. Usage: node scripts/inspect-extraction.mjs <file> <url>
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { register } from 'node:module';

// Load the TS detector through a tiny on-the-fly transpile via tsx-less approach:
// vitest already proves it; here we import the compiled logic by re-implementing
// the import through esbuild is overkill — instead reuse the built dist bundle?
// Simplest: import the source with a loader. We rely on Node's TS strip (Node 22+).
const [file, url] = process.argv.slice(2);
const html = readFileSync(file, 'utf8');
const dom = new JSDOM(html, { url });
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { detectRecipe } = await import('../src/content/detector.ts');
const r = detectRecipe(dom.window.document, url);

if (!r) {
  console.log('NO RECIPE DETECTED');
  process.exit(1);
}
const show = (label, val) => {
  const ok = val !== undefined && val !== null && !(Array.isArray(val) && val.length === 0);
  const preview = Array.isArray(val)
    ? `[${val.length}] ${JSON.stringify(val.slice(0, 2))}`
    : JSON.stringify(val);
  console.log(`${ok ? '✓' : '✗'} ${label}: ${preview}`);
};
console.log('--- extraction result ---');
show('1. image', r.imageUrl);
show('2. author', r.author);
show('3. link (sourceUrl)', r.sourceUrl);
show('4. ingredients & amounts', r.ingredients);
show('5. instructions', r.instructions);
show('6. servings (yield)', r.yield);
show('7. time (prep/cook/total min)', [r.prepTimeMinutes, r.cookTimeMinutes, r.totalTimeMinutes]);
console.log('--- extras ---');
show('description', r.description);
show('rating', [r.ratingValue, r.ratingCount]);
show('nutrition', r.nutrition ? Object.keys(r.nutrition) : undefined);
