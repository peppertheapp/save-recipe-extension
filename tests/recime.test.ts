import { describe, it, expect } from 'vitest';
import { isRecimeCollectionPage, mapRecimeRecipe } from '../src/content/recime';

describe('isRecimeCollectionPage', () => {
  it('matches the ReciMe dashboard', () => {
    expect(isRecimeCollectionPage('https://www.recime.app/dashboard/cookbooks')).toBe(true);
    expect(isRecimeCollectionPage('https://recime.app/dashboard/recipes/abc')).toBe(true);
    expect(isRecimeCollectionPage('https://www.recime.app/dashboard/cookbooks/uncategorized')).toBe(
      true,
    );
  });
  it('ignores marketing pages and other sites', () => {
    expect(isRecimeCollectionPage('https://www.recime.app/')).toBe(false);
    expect(isRecimeCollectionPage('https://www.recime.app/help/en/articles/1')).toBe(false);
    expect(isRecimeCollectionPage('https://allrecipes.com/dashboard')).toBe(false);
  });
});

// Trimmed from the real /v1/posts?id= response captured 2026-07-28.
const chickenParm = {
  id: 'faa4505a-4273-4b9e-9dd7-5055724a73cf',
  title: 'Chicken Parmesan',
  servingSize: 4,
  prepTime: 15,
  cookTime: 20,
  totalTime: 35,
  imageUrl: null,
  description: null,
  recipeUrls: ['https://www.allrecipes.com/recipe/223042/chicken-parmesan/'],
  tags: [],
  ingredients: [
    { position: 2, rawText: 'salt and freshly ground black pepper to taste', product: 'salt' },
    {
      position: 1,
      rawText: '4 skinless, boneless chicken breast halves',
      product: 'chicken breast',
    },
    { position: 3, rawText: '2 large eggs', product: 'egg' },
  ],
  instructions: [
    { position: 2, id: 2, text: 'Pound the chicken breasts flat.' },
    { position: 1, id: 1, text: 'Preheat the oven to 450 degrees F.' },
  ],
};

describe('mapRecimeRecipe', () => {
  const recipe = mapRecimeRecipe(chickenParm);

  it('keeps title, servings and times', () => {
    expect(recipe.title).toBe('Chicken Parmesan');
    expect(recipe.yield).toBe('4');
    expect(recipe.prepTimeMinutes).toBe(15);
    expect(recipe.cookTimeMinutes).toBe(20);
    expect(recipe.totalTimeMinutes).toBe(35);
  });

  it('orders ingredients and instructions by position and uses rawText', () => {
    expect(recipe.ingredients[0]).toBe('4 skinless, boneless chicken breast halves');
    expect(recipe.ingredients).toHaveLength(3);
    expect(recipe.instructions[0]).toBe('Preheat the oven to 450 degrees F.');
    expect(recipe.instructions[1]).toBe('Pound the chicken breasts flat.');
  });

  it('prefers the original source URL for dedupe', () => {
    expect(recipe.sourceUrl).toBe('https://www.allrecipes.com/recipe/223042/chicken-parmesan/');
    expect(recipe.extractionMethod).toBe('recime');
  });

  it('falls back to the ReciMe recipe page when there is no source URL', () => {
    const noSource = mapRecimeRecipe({ id: 'xyz', title: 'Homemade', ingredients: [] });
    expect(noSource.sourceUrl).toBe('https://www.recime.app/dashboard/recipes/xyz');
  });

  it('composes an ingredient line when rawText is missing', () => {
    const composed = mapRecimeRecipe({
      id: 'x',
      title: 'T',
      ingredients: [{ position: 1, qtyDisplay: '2', unitDisplay: 'cups', product: 'flour' }],
    });
    expect(composed.ingredients[0]).toBe('2 cups flour');
  });

  it('omits empty optional fields', () => {
    expect(recipe.description).toBeUndefined();
    expect(recipe.imageUrl).toBeUndefined();
  });
});
