import { describe, expect, it } from 'vitest';
import { detectHeuristicRecipe } from '../src/content/heuristic';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const URL = 'https://takethemameal.com/recipes/vegan/all/broccoli-casserole-with-two-sauces/';

describe('detectHeuristicRecipe', () => {
  it('extracts from heading + list pages with no schema markup', () => {
    const doc = parse(`<!doctype html><html><head>
      <title>Broccoli Casserole With Two Sauces</title>
      <meta property="og:image" content="https://takethemameal.com/img/casserole.jpg" />
      <meta name="author" content="TTAM Kitchen" />
    </head><body>
      <h1>Broccoli Casserole With Two Sauces</h1>
      <p>Serves 8. A cozy vegan casserole.</p>
      <h2>Ingredients</h2>
      <ul>
        <li>2 heads broccoli, chopped</li>
        <li>1 cup cashews</li>
        <li>2 cups vegetable broth</li>
        <li>1 tbsp nutritional yeast</li>
      </ul>
      <h2>Directions</h2>
      <ol>
        <li>Preheat oven to 375.</li>
        <li>Blend cashews and broth into a sauce.</li>
        <li>Combine and bake 30 minutes.</li>
      </ol>
    </body></html>`);
    const r = detectHeuristicRecipe(doc, URL);
    expect(r).not.toBeNull();
    expect(r!.extractionMethod).toBe('server');
    expect(r!.title).toBe('Broccoli Casserole With Two Sauces');
    expect(r!.ingredients).toHaveLength(4);
    expect(r!.instructions).toHaveLength(3);
    expect(r!.imageUrl).toBe('https://takethemameal.com/img/casserole.jpg');
    expect(r!.author).toBe('TTAM Kitchen');
    expect(r!.yield).toBe('8');
  });

  it('handles paragraph-style instructions', () => {
    const doc = parse(`<html><body>
      <h1>Grandma's Stew</h1>
      <h3>Ingredients</h3>
      <ul><li>1 lb beef</li><li>3 carrots</li><li>2 potatoes</li></ul>
      <h3>Method</h3>
      <p>Brown the beef in a heavy pot over medium-high heat.</p>
      <p>Add vegetables and cover with water; simmer two hours.</p>
    </body></html>`);
    const r = detectHeuristicRecipe(doc, 'https://example.com/stew');
    expect(r).not.toBeNull();
    expect(r!.instructions).toHaveLength(2);
  });

  it('rejects pages missing either section', () => {
    const onlyIngredients = parse(`<html><body>
      <h1>Shopping list</h1>
      <h2>Ingredients</h2>
      <ul><li>milk</li><li>eggs</li><li>bread</li></ul>
    </body></html>`);
    expect(detectHeuristicRecipe(onlyIngredients, 'https://example.com/list')).toBeNull();

    const noLists = parse(`<html><body>
      <h1>Article about ingredients</h1>
      <h2>Ingredients</h2><p>are important.</p>
      <h2>Instructions</h2><p>follow them.</p>
    </body></html>`);
    expect(detectHeuristicRecipe(noLists, 'https://example.com/article')).toBeNull();
  });

  it('rejects ordinary pages', () => {
    const doc = parse(`<html><body>
      <h1>Search results</h1>
      <ul><li>Result one</li><li>Result two</li><li>Result three</li></ul>
    </body></html>`);
    expect(detectHeuristicRecipe(doc, 'https://example.com/search')).toBeNull();
  });
});
