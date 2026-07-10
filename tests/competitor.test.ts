import { describe, expect, it } from 'vitest';
import { cardRecipeFor, COMPETITOR_TARGETS, targetsForHost } from '../src/content/competitor';

// Trimmed from live allrecipes.com/tiktok-recipes-8422099 markup (2026-07-09).
const ROUNDUP_HTML = `
<div id="mm-myrecipes-favorite_1-0" class="comp mm-myrecipes-favorite "
  data-tracking-subtype="Card #1|Save Recipe"
  data-tracking-metadata-label="TikTok Ramen"
  data-tracking-target-url="https://www.allrecipes.com/recipe/8519103/tiktok-ramen/"
  data-tracking-category="MyRecipes"></div>
<div id="mm-recipes-save-button-placeholder_1-0"
  class="comp mm-recipes-save-button-placeholder mm-myrecipes-favorite "
  data-tracking-subtype="Recipe Save"
  data-tracking-metadata-label="World's Best Lasagna"
  data-tracking-category="MyRecipes"></div>
`;

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('targetsForHost', () => {
  it('matches network domains and subdomains', () => {
    expect(targetsForHost('www.allrecipes.com')).toBeDefined();
    expect(targetsForHost('allrecipes.com')).toBeDefined();
    expect(targetsForHost('www.eatingwell.com')).toBeDefined();
    expect(targetsForHost('www.seriouseats.com')).toBeDefined();
    expect(targetsForHost('www.simplyrecipes.com')).toBeDefined();
    expect(targetsForHost('www.thespruceeats.com')).toBeDefined();
    expect(targetsForHost('www.foodandwine.com')).toBeDefined();
    expect(targetsForHost('www.liquor.com')).toBeDefined();
    expect(targetsForHost('www.myrecipes.com')).toBeDefined();
    expect(targetsForHost('smittenkitchen.com')).toBeUndefined();
    expect(targetsForHost('notallrecipes.com')).toBeUndefined();
  });
});

describe('roundup selectors', () => {
  const selectors = COMPETITOR_TARGETS[0]!.selectors;

  it('finds both roundup-card and recipe-page save containers', () => {
    const doc = parse(ROUNDUP_HTML);
    const matched = new Set<Element>();
    for (const { selector } of selectors) {
      for (const el of doc.querySelectorAll(selector)) matched.add(el);
    }
    expect(matched.size).toBe(2);
  });
});

describe('nav exclusion', () => {
  // Live header markup: the "My Saves" nav link contains the same heart icon
  // class as save buttons. It must never be covered (regression: we covered it).
  const NAV_HTML = `
    <ul class="mntl-utility-nav">
      <li><a class="mntl-utility-nav__sublist-link myr-login-trigger" aria-label="Go to MyRecipes" href="/account/my-saves">
        <svg class="icon save-icon-favorite icon-myr-favorite"></svg> My Saves
      </a></li>
    </ul>
    <div class="mm-myrecipes-favorite" data-tracking-subtype="Card #1|Save Recipe"
      data-tracking-target-url="https://www.allrecipes.com/recipe/1/x/"></div>`;

  it('excludes nav "My Saves" but keeps real save buttons', () => {
    const doc = parse(NAV_HTML);
    const target = COMPETITOR_TARGETS[0]!;
    const covered: Element[] = [];
    for (const { selector, resolve } of target.selectors) {
      for (const match of doc.querySelectorAll(selector)) {
        const el =
          resolve === 'closest-control'
            ? (match.closest('button, a, [role="button"]') ?? match)
            : match;
        if (covered.includes(el)) continue;
        if (el.closest(target.exclude)) continue;
        covered.push(el);
      }
    }
    expect(covered).toHaveLength(1);
    expect(covered[0]!.className).toContain('mm-myrecipes-favorite');
  });
});

describe('cardRecipeFor', () => {
  const pageUrl = 'https://www.allrecipes.com/tiktok-recipes-8422099';

  it('extracts the card recipe URL and title on roundup pages', () => {
    const doc = parse(ROUNDUP_HTML);
    const card = cardRecipeFor(doc.querySelector('.mm-myrecipes-favorite')!, pageUrl);
    expect(card).toEqual({
      url: 'https://www.allrecipes.com/recipe/8519103/tiktok-ramen/',
      title: 'TikTok Ramen',
    });
  });

  it('returns null on recipe pages (no target URL → save the page itself)', () => {
    const doc = parse(ROUNDUP_HTML);
    const placeholder = doc.querySelector('.mm-recipes-save-button-placeholder')!;
    expect(cardRecipeFor(placeholder, pageUrl)).toBeNull();
  });

  it('returns null when the target URL is the page itself', () => {
    const doc = parse(
      `<div class="mm-myrecipes-favorite" data-tracking-target-url="${pageUrl}"></div>`,
    );
    expect(cardRecipeFor(doc.querySelector('.mm-myrecipes-favorite')!, `${pageUrl}?utm=x`)).toBeNull();
  });

  it('inherits the URL from an ancestor carrier', () => {
    const doc = parse(
      `<a data-tracking-target-url="https://www.allrecipes.com/recipe/1/x/" data-tracking-metadata-label="X">
         <span class="save-icon-favorite"></span>
       </a>`,
    );
    const card = cardRecipeFor(doc.querySelector('.save-icon-favorite')!, pageUrl);
    expect(card?.url).toBe('https://www.allrecipes.com/recipe/1/x/');
  });

  it('rejects junk URLs', () => {
    const doc = parse(`<div class="mm-myrecipes-favorite" data-tracking-target-url="javascript:void(0)"></div>`);
    expect(cardRecipeFor(doc.querySelector('.mm-myrecipes-favorite')!, pageUrl)).toBeNull();
  });
});
