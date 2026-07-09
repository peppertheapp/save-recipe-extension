/**
 * Phase 4 — MyRecipes-network overlay module (NOT yet wired into index.ts).
 *
 * Strategy per the build plan: position a clearly-Pepper-branded button exactly
 * over the site's save button (never remove/modify their DOM nodes, never mimic
 * their design, never touch their handlers). Gated behind the
 * `replaceCompetitorButtons` setting (default ON) and disclosed in the CWS listing.
 *
 * The registry below ships as a compiled default; a remote JSON (fetched daily,
 * cached in chrome.storage.local) will override it so selector rot is a config
 * change, not a release.
 */

export interface CompetitorTarget {
  domains: string[];
  /** Verify actual selectors on live sites at build time — these WILL change. */
  selectors: string[];
  strategy: 'overlay';
}

export const COMPETITOR_TARGETS: CompetitorTarget[] = [
  {
    domains: [
      'allrecipes.com',
      'eatingwell.com',
      'foodandwine.com',
      'simplyrecipes.com',
      'seriouseats.com',
      'thespruceeats.com',
      'realsimple.com',
      'southernliving.com',
      'marthastewart.com',
    ],
    selectors: ['[class*="save-button"]', 'button[data-tracking*="save"]'],
    strategy: 'overlay',
  },
];

export function targetsForHost(hostname: string): CompetitorTarget | undefined {
  return COMPETITOR_TARGETS.find((t) =>
    t.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`)),
  );
}
