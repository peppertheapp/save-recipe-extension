import { describe, expect, it } from 'vitest';
import {
  collectRecipeLinks,
  extractBookmarksFromJson,
  isCollectionPage,
  titleFromSlug,
} from '../src/content/migration';

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

describe('collectRecipeLinks — MyRecipes favorites app (data-doc-url cards)', () => {
  // Verbatim structure from the live favorites page: cards are <li>s with the
  // recipe URL in data-doc-url, no anchors at all.
  const FAVORITES_HTML = `
    <ul class="recently-saved__list">
      <li data-doc-id="7966464" data-doc-url="https://www.allrecipes.com/chicken-cobbler-recipe-7966464" class="recently-saved__item" tabindex="0">
        <div class="myr-image__container" aria-hidden="true">
          <img src="https://www.myrecipes.com/thmb/x.jpg" alt="This TikTok Chicken Cobbler is Seriously Impressive" class="myr-image__media recently-saved__image">
        </div>
        <div class="recently-saved__item-info">
          <div class="recently-saved__item-title">This TikTok Chicken Cobbler is Seriously Impressive</div>
        </div>
      </li>
      <li data-doc-id="1" data-doc-url="https://www.eatingwell.com/baked-feta-pasta-recipe-8402099" class="recently-saved__item">
        <div class="recently-saved__item-title">Baked Feta Pasta</div>
      </li>
      <li data-doc-id="2" data-doc-url="https://evil.example.com/recipe/1/x/" class="recently-saved__item"></li>
    </ul>`;

  it('collects cards via data-doc-url with the image alt as title', () => {
    const links = collectRecipeLinks(parse(FAVORITES_HTML));
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      url: 'https://www.allrecipes.com/chicken-cobbler-recipe-7966464',
      title: 'This TikTok Chicken Cobbler is Seriously Impressive',
    });
    expect(links[1]!.title).toBe('Baked Feta Pasta');
  });
});

describe('extractBookmarksFromJson', () => {
  it('finds network URLs + titles in unknown JSON shapes, skipping images', () => {
    const payload = {
      status: 'ok',
      data: {
        bookmarks: [
          {
            docId: '7966464',
            url: 'https://www.allrecipes.com/chicken-cobbler-recipe-7966464',
            title: 'This TikTok Chicken Cobbler is Seriously Impressive',
            imageUrl: 'https://www.myrecipes.com/thmb/EUVFzQ.jpg',
          },
          {
            document: {
              canonicalUrl: 'https://www.seriouseats.com/classic-panzanella-salad-recipe',
              headline: 'Classic Panzanella Salad',
              thumbnailUrl: 'https://www.seriouseats.com/thmb/y.jpg',
            },
          },
          { url: 'https://www.google.com/not-ours', title: 'nope' },
        ],
      },
    };
    const links = extractBookmarksFromJson(payload);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      url: 'https://www.allrecipes.com/chicken-cobbler-recipe-7966464',
      title: 'This TikTok Chicken Cobbler is Seriously Impressive',
    });
    expect(links[1]).toEqual({
      url: 'https://www.seriouseats.com/classic-panzanella-salad-recipe',
      title: 'Classic Panzanella Salad',
    });
  });

  it('falls back to slug titles and handles junk input', () => {
    expect(extractBookmarksFromJson(null)).toEqual([]);
    expect(extractBookmarksFromJson('nope')).toEqual([]);
    const links = extractBookmarksFromJson([
      { docUrl: 'https://www.eatingwell.com/baked-feta-pasta-recipe-8402099' },
    ]);
    expect(links[0]!.title).toBe('Baked Feta Pasta Recipe');
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
