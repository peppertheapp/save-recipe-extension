import { describe, expect, it } from 'vitest';
import { captionFromOgDescription, detectSocialRecipe, looksLikeRecipe } from '../src/content/social';

function docFromHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const IG_RECIPE_CAPTION =
  '30-minute dragon noodles 🌶🔥\n' +
  'Ingredients: 6 oz lo mein noodles, 2 tbsp butter, 1 tbsp sriracha, 1 egg, 1 tbsp brown sugar.\n' +
  'Boil noodles, scramble egg in butter, toss with sauce. Full recipe on the blog!';

function igDoc(caption: string): Document {
  return docFromHtml(`<!doctype html><html><head>
    <meta property="og:title" content="Chef Jake on Instagram" />
    <meta property="og:description" content='412 likes, 37 comments - chefjake on July 8, 2026: "${caption.replaceAll('\n', ' ')}"' />
    <meta property="og:image" content="https://scontent.example.com/noodles.jpg" />
  </head><body></body></html>`);
}

describe('detectSocialRecipe', () => {
  it('captures a recipe-ish Instagram caption from og:description', () => {
    const r = detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://www.instagram.com/p/DafloB1KWH5/?hl=en');
    expect(r).not.toBeNull();
    expect(r!.extractionMethod).toBe('server');
    expect(r!.description).toContain('lo mein noodles');
    expect(r!.imageUrl).toBe('https://scontent.example.com/noodles.jpg');
    expect(r!.title).toContain('dragon noodles');
  });

  it('prefers the on-page caption element when present', () => {
    const doc = docFromHtml(`<!doctype html><html><head></head><body>
      <article><h1>Best focaccia recipe: 500g flour, 400ml water, 10g salt, 5g yeast. Mix, rest, bake.</h1></article>
    </body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.instagram.com/reel/xyz/');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('500g flour');
  });

  it('ignores non-recipe posts', () => {
    const r = detectSocialRecipe(
      igDoc('Sunset at the beach with the crew 🌅 best night ever, love you all'),
      'https://www.instagram.com/p/abc123/',
    );
    expect(r).toBeNull();
  });

  it('ignores non-post pages even with recipe-ish text', () => {
    const r = detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://www.instagram.com/chefjake/');
    expect(r).toBeNull();
  });

  it('ignores non-social hosts', () => {
    const r = detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://example.com/p/123/');
    expect(r).toBeNull();
  });

  it('captures TikTok video captions', () => {
    const doc = docFromHtml(`<!doctype html><html><head>
      <meta property="og:description" content="easiest 3 ingredient pasta!! 1 cup cream, 2 cups parm, 1 tbsp pepper #recipe #fyp" />
    </head><body></body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.tiktok.com/@cook/video/7301234567890123456');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('3 ingredient pasta');
  });
});

describe('looksLikeRecipe', () => {
  it('accepts keyword matches', () => {
    expect(looksLikeRecipe('full recipe below!')).toBe(true);
    expect(looksLikeRecipe('INGREDIENTS: stuff')).toBe(true);
  });
  it('accepts two or more measurements', () => {
    expect(looksLikeRecipe('2 cups flour and 1 tbsp sugar')).toBe(true);
  });
  it('rejects one-off measurements and plain captions', () => {
    expect(looksLikeRecipe('ran 5 g of protein today lol')).toBe(false);
    expect(looksLikeRecipe('beach day with friends')).toBe(false);
  });
});

describe('captionFromOgDescription', () => {
  it('unwraps Instagram engagement chrome', () => {
    expect(
      captionFromOgDescription(
        '10 likes, 2 comments - user on July 1, 2026: "hello world"',
        document,
      ),
    ).toBe('hello world');
  });
  it('passes through plain descriptions', () => {
    expect(captionFromOgDescription('just a caption', document)).toBe('just a caption');
  });
  it('handles empty input', () => {
    expect(captionFromOgDescription('', document)).toBe('');
  });
});
