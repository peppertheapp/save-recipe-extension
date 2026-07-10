import { describe, expect, it } from 'vitest';
import { collectRecipeLinks, isCollectionPage, titleFromSlug } from '../src/content/migration';

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('isCollectionPage', () => {
  it('matches the MyRecipes favorites app (path and hash routes)', () => {
    expect(isCollectionPage('https://www.myrecipes.com/favorites')).toBe(true);
    expect(isCollectionPage('https://www.myrecipes.com/favorites#/')).toBe(true);
    expect(isCollectionPage('https://www.myrecipes.com/favorites#/collections/3')).toBe(true);
  });
  it('matches allrecipes saved pages', () => {
    expect(isCollectionPage('https://www.allrecipes.com/account/my-saves')).toBe(true);
  });
  it('ignores everything else', () => {
    expect(isCollectionPage('https://www.myrecipes.com/')).toBe(false);
    expect(isCollectionPage('https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/')).toBe(false);
    expect(isCollectionPage('not a url')).toBe(false);
  });
});

describe('collectRecipeLinks', () => {
  it('collects recipe links across network domains, deduped, with titles', () => {
    const doc = parse(`
      <a href="https://www.allrecipes.com/recipe/8519103/tiktok-ramen/">TikTok Ramen</a>
      <a href="https://www.allrecipes.com/recipe/8519103/tiktok-ramen/">TikTok Ramen (dupe)</a>
      <a href="https://www.seriouseats.com/classic-panzanella-salad-recipe">   Panzanella
        Salad  </a>
      <a href="https://www.eatingwell.com/baked-feta-pasta-recipe-8402099"></a>
      <a href="https://www.foodandwine.com/recipes/perfect-margarita">Margarita</a>
      <a href="https://www.myrecipes.com/favorites#/settings">Settings</a>
      <a href="https://www.google.com/search?q=lasagna+recipe">not ours</a>
      <a href="https://www.allrecipes.com/about-us">About us</a>
    `);
    const links = collectRecipeLinks(doc);
    expect(links).toHaveLength(4);
    expect(links[0]).toEqual({
      url: 'https://www.allrecipes.com/recipe/8519103/tiktok-ramen/',
      title: 'TikTok Ramen',
    });
    expect(links[1]!.title).toBe('Panzanella Salad');
    // Empty link text falls back to a prettified slug.
    expect(links[2]!.title).toBe('Baked Feta Pasta Recipe');
  });
});

describe('titleFromSlug', () => {
  it('prettifies slugs and strips ids', () => {
    expect(titleFromSlug('https://www.allrecipes.com/recipe/8519103/tiktok-ramen/')).toBe('Tiktok Ramen');
    expect(titleFromSlug('https://www.eatingwell.com/baked-feta-pasta-recipe-8402099')).toBe(
      'Baked Feta Pasta Recipe',
    );
  });
});
