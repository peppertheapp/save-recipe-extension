import { describe, expect, it } from 'vitest';
import { parseSteps } from '../src/shared/ai';

describe('parseSteps', () => {
  it('strips numbering and preamble from the model output', () => {
    const out = [
      "Here's how to make it:",
      '1. Season the chicken with salt, pepper, garlic and onion powder.',
      '2. Sear in olive oil over medium-high heat until golden, about 5 minutes per side.',
      '3. Whisk butter, brown sugar, garlic, honey, soy sauce and rice vinegar into a sauce.',
      '4. Simmer the chicken in the sauce until glazed. Serve over white rice.',
    ].join('\n');
    const steps = parseSteps(out);
    expect(steps).toHaveLength(4);
    expect(steps![0]).toBe('Season the chicken with salt, pepper, garlic and onion powder.');
    expect(steps![3]).toContain('Serve over white rice');
  });

  it('handles bullet and "Step N:" formats', () => {
    expect(parseSteps('- Preheat oven\n- Bake 20 min')).toEqual(['Preheat oven', 'Bake 20 min']);
    expect(parseSteps('Step 1: Mix\nStep 2: Pour')).toEqual(['Mix', 'Pour']);
  });

  it('returns null for empty or non-step output', () => {
    expect(parseSteps('')).toBeNull();
    expect(parseSteps('Sure')).toBeNull();
  });
});
