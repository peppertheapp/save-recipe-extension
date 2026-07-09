import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanText, detectRecipe, parseIsoDurationMinutes } from '../src/content/detector';
import type { ExtractedRecipe } from '../src/shared/types';

function loadFixture(name: string): Document {
  const html = readFileSync(join(process.cwd(), 'tests', 'fixtures', `${name}.html`), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

function detect(name: string): ExtractedRecipe | null {
  return detectRecipe(loadFixture(name), `https://www.${name}.example/recipe`);
}

describe('detectRecipe fixtures', () => {
  it('allrecipes: @graph, @type array, HowToStep objects, widest image', () => {
    const r = detect('allrecipes');
    expect(r).not.toBeNull();
    expect(r!.extractionMethod).toBe('json-ld');
    expect(r!.title).toBe("World's Best Lasagna");
    expect(r!.description).toContain('sausage & three kinds of cheese');
    expect(r!.ingredients).toHaveLength(8);
    expect(r!.instructions).toHaveLength(5);
    expect(r!.imageUrl).toBe('https://img.example.com/lasagna-16x9.jpg'); // widest wins
    expect(r!.author).toBe('John Chandler');
    expect(r!.prepTimeMinutes).toBe(30);
    expect(r!.cookTimeMinutes).toBe(150);
    expect(r!.totalTimeMinutes).toBe(195);
    expect(r!.yield).toBe('12');
    expect(r!.cuisine).toEqual(['Italian']);
    expect(r!.keywords).toEqual(['lasagna', 'pasta', 'baked']);
    expect(r!.nutrition?.calories).toBe('448 kcal');
    expect(r!.ratingValue).toBe(4.8);
    expect(r!.ratingCount).toBe(20463);
  });

  it('seriouseats: top-level array, reviewCount fallback', () => {
    const r = detect('seriouseats');
    expect(r!.title).toBe('Halal Cart-Style Chicken and Rice With White Sauce');
    expect(r!.ingredients).toHaveLength(6);
    expect(r!.instructions).toHaveLength(4);
    expect(r!.prepTimeMinutes).toBe(90);
    expect(r!.totalTimeMinutes).toBe(110);
    expect(r!.cuisine).toEqual(['Middle Eastern']);
    expect(r!.ratingCount).toBe(312);
  });

  it('budgetbytes: HowToSection nesting flattens in order', () => {
    const r = detect('budgetbytes');
    expect(r!.title).toBe('Dragon Noodles');
    expect(r!.ingredients).toHaveLength(7);
    expect(r!.instructions).toHaveLength(5);
    expect(r!.instructions[0]).toContain('Begin boiling water');
    expect(r!.instructions[4]).toContain('green onions');
    expect(r!.yield).toBe('2 servings'); // most descriptive of ["2", "2 servings"]
    expect(r!.totalTimeMinutes).toBe(15);
  });

  it('bonappetit: plain-string instructions, hex entities', () => {
    const r = detect('bonappetit');
    expect(r!.title).toBe('BA’s Best Chocolate Chip Cookies');
    expect(r!.ingredients).toHaveLength(9);
    expect(r!.instructions).toHaveLength(6);
    expect(r!.instructions[1]).toBe('Cook half of the butter in a saucepan until it browns & smells nutty.');
    expect(r!.imageUrl).toBe('https://img.example.com/ba-cookies.jpg');
  });

  it('foodcom: nutrition map, yield array', () => {
    const r = detect('foodcom');
    expect(r!.ingredients).toHaveLength(8);
    expect(r!.instructions).toHaveLength(5);
    expect(r!.yield).toBe('1 loaf');
    expect(r!.nutrition?.calories).toBe('271.7');
    expect(r!.nutrition?.['@type']).toBeUndefined();
    expect(r!.ratingValue).toBe(4.5);
  });

  it('smittenkitchen: newline-separated instruction blob, string author, numeric entities', () => {
    const r = detect('smittenkitchen');
    expect(r!.title).toBe('mom’s apple cake');
    expect(r!.author).toBe('deb');
    expect(r!.description).toContain('— the one everyone’s mom');
    expect(r!.ingredients).toHaveLength(11);
    expect(r!.instructions).toHaveLength(6);
    expect(r!.instructions[5]).toContain('tester comes out clean');
    expect(r!.totalTimeMinutes).toBe(120);
  });

  it('kingarthur: microdata fallback when no JSON-LD', () => {
    const r = detect('kingarthur');
    expect(r!.extractionMethod).toBe('microdata');
    expect(r!.title).toBe('Classic Sandwich Bread');
    expect(r!.description).toBe('Soft-crusted, tender white sandwich bread.');
    expect(r!.ingredients).toHaveLength(7);
    expect(r!.instructions).toHaveLength(5);
    expect(r!.prepTimeMinutes).toBe(18);
    expect(r!.totalTimeMinutes).toBe(195);
    expect(r!.imageUrl).toBe('https://img.example.com/sandwich-bread.jpg');
    expect(r!.yield).toBe('1 loaf, 16 slices');
  });

  it('delish: comma-separated keywords/category strings split', () => {
    const r = detect('delish');
    expect(r!.title).toBe('Best-Ever Chicken Alfredo');
    expect(r!.ingredients).toHaveLength(9);
    expect(r!.instructions).toHaveLength(4);
    expect(r!.keywords).toEqual(['chicken alfredo', 'pasta', 'weeknight dinner', 'comfort food']);
    expect(r!.category).toEqual(['weeknight meals', 'dinner']);
    expect(r!.instructions[0]).toContain('reserve 1 cup pasta water');
  });

  it('tasty: string-array image, numeric yield, day-scale duration', () => {
    const r = detect('tasty');
    expect(r!.ingredients).toHaveLength(10);
    expect(r!.instructions).toHaveLength(7);
    expect(r!.yield).toBe('12');
    expect(r!.imageUrl).toBe('https://img.example.com/tasty-cookies-1x1.jpg');
    expect(r!.totalTimeMinutes).toBe(1470); // P1DT30M
    expect(r!.keywords).toEqual(['cookies', 'dessert', 'chocolate']);
  });

  it('wordpress blog: skips malformed JSON-LD block, named entities, sections', () => {
    const r = detect('wordpress-blog');
    expect(r!.title).toBe('Grandma’s Chicken Soup');
    expect(r!.description).toBe('The soup that fixes everything — colds, bad days, you name it.');
    expect(r!.ingredients).toHaveLength(8);
    expect(r!.ingredients[1]).toBe('3 carrots, peeled & chopped');
    expect(r!.instructions).toHaveLength(6);
    expect(r!.imageUrl).toBe('https://img.example.com/chicken-soup.jpg');
  });

  it('non-recipe page returns null', () => {
    expect(detect('no-recipe')).toBeNull();
  });

  it('every recipe fixture records the page URL as sourceUrl', () => {
    const r = detect('allrecipes');
    expect(r!.sourceUrl).toBe('https://www.allrecipes.example/recipe');
  });
});

describe('parseIsoDurationMinutes', () => {
  it('parses common forms', () => {
    expect(parseIsoDurationMinutes('PT30M')).toBe(30);
    expect(parseIsoDurationMinutes('PT1H30M')).toBe(90);
    expect(parseIsoDurationMinutes('PT90M')).toBe(90);
    expect(parseIsoDurationMinutes('P1DT30M')).toBe(1470);
    expect(parseIsoDurationMinutes('PT45S')).toBe(1);
    expect(parseIsoDurationMinutes('P0DT1H')).toBe(60);
  });
  it('rejects junk', () => {
    expect(parseIsoDurationMinutes('')).toBeNull();
    expect(parseIsoDurationMinutes('30 minutes')).toBeNull();
    expect(parseIsoDurationMinutes('P')).toBeNull();
    expect(parseIsoDurationMinutes('PT')).toBeNull();
  });
});

describe('cleanText', () => {
  it('decodes entities, strips tags, collapses whitespace', () => {
    expect(cleanText('Salt &amp; pepper', document)).toBe('Salt & pepper');
    expect(cleanText('<b>Bold</b> move', document)).toBe('Bold move');
    expect(cleanText('  spaced\n\tout  ', document)).toBe('spaced out');
    expect(cleanText('', document)).toBe('');
  });
});
