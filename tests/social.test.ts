import { describe, expect, it } from 'vitest';
import {
  authorFromOgDescription,
  captionFromOgDescription,
  detectSocialRecipe,
  looksLikeRecipe,
  metasAreFresh,
  parseCaptionRecipe,
} from '../src/content/social';

function docFromHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const IG_RECIPE_CAPTION =
  '30-minute dragon noodles 🌶🔥\n' +
  'Ingredients: 6 oz lo mein noodles, 2 tbsp butter, 1 tbsp sriracha, 1 egg, 1 tbsp brown sugar.\n' +
  'Boil noodles, scramble egg in butter, toss with sauce. Full recipe on the blog!';

function igDoc(caption: string, ogUrl = ''): Document {
  return docFromHtml(`<!doctype html><html><head>
    <meta property="og:title" content="Chef Jake on Instagram" />
    <meta name="description" content='412 likes, 37 comments - chefjake on July 8, 2026: "${caption.replaceAll('\n', ' ')}"' />
    ${ogUrl ? `<meta property="og:url" content="${ogUrl}" />` : ''}
    <meta property="og:image" content="https://scontent.example.com/noodles.jpg" />
  </head><body></body></html>`);
}

describe('detectSocialRecipe — Instagram', () => {
  it('captures a recipe-ish caption from the meta description wrapper', () => {
    const r = detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://www.instagram.com/p/DafloB1KWH5/?hl=en');
    expect(r).not.toBeNull();
    expect(r!.extractionMethod).toBe('server');
    expect(r!.description).toContain('lo mein noodles');
    expect(r!.imageUrl).toBe('https://scontent.example.com/noodles.jpg');
    expect(r!.author).toBe('chefjake');
  });

  it('supports /username/reel/ paths', () => {
    const r = detectSocialRecipe(
      igDoc(IG_RECIPE_CAPTION),
      'https://www.instagram.com/kerrygoldsouthafrica/reel/DafloB1KWH5/',
    );
    expect(r).not.toBeNull();
  });

  it('prefers the on-page caption element when present', () => {
    const doc = docFromHtml(`<!doctype html><html><head></head><body>
      <article><h1>Best focaccia recipe: 500g flour, 400ml water, 10g salt, 5g yeast. Mix, rest, bake.</h1></article>
    </body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.instagram.com/reel/xyz/');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('500g flour');
  });

  it('rejects stale metas after SPA navigation (og:url mismatch)', () => {
    const doc = igDoc(IG_RECIPE_CAPTION, 'https://www.instagram.com/p/OLD_POST/');
    const r = detectSocialRecipe(doc, 'https://www.instagram.com/p/NEW_POST/');
    expect(r).toBeNull();
  });

  it('ignores non-recipe posts and non-post pages', () => {
    expect(
      detectSocialRecipe(igDoc('Sunset at the beach with the crew 🌅 love you all'), 'https://www.instagram.com/p/abc/'),
    ).toBeNull();
    expect(detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://www.instagram.com/chefjake/')).toBeNull();
    expect(detectSocialRecipe(igDoc(IG_RECIPE_CAPTION), 'https://example.com/p/123/')).toBeNull();
  });
});

describe('detectSocialRecipe — TikTok', () => {
  it('reads the caption from __UNIVERSAL_DATA_FOR_REHYDRATION__', () => {
    const state = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          itemInfo: {
            itemStruct: {
              desc: 'easiest 3 ingredient pasta! 1 cup cream, 2 cups parm, 1 tbsp pepper #recipe',
              author: { nickname: 'feelgoodfoodie' },
            },
          },
        },
      },
    };
    const doc = docFromHtml(`<!doctype html><html><head>
      <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>
    </head><body></body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.tiktok.com/@feelgoodfoodie/video/7301234567890123456');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('3 ingredient pasta');
    expect(r!.author).toBe('feelgoodfoodie');
  });

  it('falls back to og:description', () => {
    const doc = docFromHtml(`<!doctype html><html><head>
      <meta property="og:description" content="easiest 3 ingredient pasta!! 1 cup cream, 2 cups parm, 1 tbsp pepper #recipe" />
    </head><body></body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.tiktok.com/@cook/video/7301234567890123456');
    expect(r).not.toBeNull();
  });
});

describe('detectSocialRecipe — Facebook', () => {
  it('reads reel captions from relay script payloads', () => {
    const payload = `{"data":{"creation_story":{"message":{"text":"Garlic butter prawns recipe \\ud83e\\udd90\\n2 lbs prawns\\n4 tbsp butter\\n6 cloves garlic\\nSaut\\u00e9 garlic in butter, add prawns, cook for 4 minutes."}}}}`;
    const doc = docFromHtml(`<!doctype html><html><head>
      <script>requireLazy(["x"], function() { handle(${payload}); });</script>
    </head><body></body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.facebook.com/reel/1808153320153124');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('Garlic butter prawns');
    expect(r!.description).toContain('Sauté garlic in butter');
  });

  it('falls back to recipe-looking dir="auto" blocks', () => {
    const doc = docFromHtml(`<!doctype html><html><body>
      <div dir="auto">just vibes</div>
      <div dir="auto">One pot chicken: 2 cups rice, 1 lb chicken thighs, 3 cups stock. Simmer 20 minutes covered.</div>
    </body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.facebook.com/watch/?v=123');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('One pot chicken');
  });
});

describe('detectSocialRecipe — Pinterest', () => {
  it('reads pin descriptions from data-test-id nodes', () => {
    const doc = docFromHtml(`<!doctype html><html><body>
      <div data-test-id="truncated-description">Slow cooker carnitas recipe — 3 lbs pork shoulder, 1 tbsp cumin, juice of 2 limes.</div>
    </body></html>`);
    const r = detectSocialRecipe(doc, 'https://www.pinterest.com/pin/1234567890/');
    expect(r).not.toBeNull();
    expect(r!.description).toContain('carnitas');
  });
});

describe('metasAreFresh', () => {
  const doc = (ogUrl: string): Document =>
    docFromHtml(`<html><head><meta property="og:url" content="${ogUrl}" /></head></html>`);
  it('accepts matching paths and missing og:url', () => {
    expect(metasAreFresh(doc('https://www.instagram.com/p/ABC/'), 'https://www.instagram.com/p/ABC/?hl=en')).toBe(true);
    expect(metasAreFresh(docFromHtml('<html></html>'), 'https://x.com/y')).toBe(true);
  });
  it('rejects mismatched paths', () => {
    expect(metasAreFresh(doc('https://www.instagram.com/p/OLD/'), 'https://www.instagram.com/p/NEW/')).toBe(false);
  });
});

describe('looksLikeRecipe', () => {
  it('accepts keywords, measurements, and cooking verbs', () => {
    expect(looksLikeRecipe('full recipe below!')).toBe(true);
    expect(looksLikeRecipe('2 cups flour and 1 tbsp sugar')).toBe(true);
    expect(looksLikeRecipe('Preheat the oven then whisk the eggs')).toBe(true);
    expect(looksLikeRecipe('½ cup butter, simmer gently')).toBe(true);
  });
  it('rejects ordinary captions', () => {
    expect(looksLikeRecipe('ran 5 g of protein today lol')).toBe(false);
    expect(looksLikeRecipe('beach day with friends')).toBe(false);
    expect(looksLikeRecipe('this restaurant makes the best pasta')).toBe(false);
  });
});

describe('parseCaptionRecipe', () => {
  it('splits on explicit section headers', () => {
    const { ingredients, instructions } = parseCaptionRecipe(
      'Dragon noodles 🌶\n' +
        'INGREDIENTS:\n- 6 oz lo mein noodles\n- 2 tbsp butter\n- 1 tbsp sriracha\n' +
        'Instructions\n1. Boil the noodles.\n2. Scramble the egg in butter.\n3. Toss with sauce.\n' +
        'Notes: extra sriracha if you dare\n#noodles #recipe',
    );
    expect(ingredients).toEqual(['6 oz lo mein noodles', '2 tbsp butter', '1 tbsp sriracha']);
    expect(instructions).toEqual([
      'Boil the noodles.',
      'Scramble the egg in butter.',
      'Toss with sauce.',
    ]);
  });

  it('classifies headerless captions by line shape', () => {
    const { ingredients, instructions } = parseCaptionRecipe(
      'One pan salmon!\n2 salmon fillets (6 oz each)\n1 tbsp olive oil\nPreheat oven to 400 and bake for 12 minutes.\n#salmon',
    );
    expect(ingredients).toContain('2 salmon fillets (6 oz each)');
    expect(ingredients).toContain('1 tbsp olive oil');
    expect(instructions.some((l) => l.includes('Preheat oven'))).toBe(true);
  });

  it('drops hashtag noise and returns empty for unstructured text', () => {
    const { ingredients, instructions } = parseCaptionRecipe('so delicious!\n#food #yum #recipe');
    expect(ingredients).toEqual([]);
    expect(instructions).toEqual([]);
  });
});

describe('caption helpers', () => {
  it('unwraps engagement chrome and extracts author', () => {
    const raw = '10 likes, 2 comments - chef.jake on July 1, 2026: "hello world"';
    expect(captionFromOgDescription(raw, document)).toBe('hello world');
    expect(authorFromOgDescription(raw)).toBe('chef.jake');
    expect(captionFromOgDescription('just a caption', document)).toBe('just a caption');
    expect(captionFromOgDescription('', document)).toBe('');
  });
});
