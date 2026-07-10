/**
 * Phase 4 — overlay module: on MyRecipes-network sites, a clearly-Pepper-branded
 * save button sits exactly on top of the site's save button and captures the
 * click. We never remove or modify their DOM nodes, never call their handlers,
 * and never mimic their visual design. Behavior is disclosed in the Chrome Web
 * Store listing (see docs/STORE_LISTING.md before shipping updates).
 */

interface CompetitorSelector {
  selector: string;
  /**
   * 'self': the match IS the save control/container — cover it directly.
   * 'closest-control': the match is an inner icon — cover its nearest
   * button/link ancestor. Never used for containers, because resolving a
   * card's save div upward would grab the whole recipe card link.
   */
  resolve: 'self' | 'closest-control';
}

export interface CompetitorTarget {
  domains: string[];
  /** Verified against live allrecipes.com markup 2026-07-09 (recipe + roundup pages) — these WILL rot; re-check per release. */
  selectors: CompetitorSelector[];
  /**
   * Never cover an element inside these. Site navigation ("My Saves" links to
   * the user's saved-recipes page) must stay clickable — it's the entry point
   * for the Phase 5 collection import.
   */
  exclude: string;
}

export const COMPETITOR_TARGETS: CompetitorTarget[] = [
  {
    // Dotdash Meredith / MyRecipes network — shared component system ("mm-", myr-favorite).
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
    selectors: [
      // Recipe pages: the hydrating placeholder under the recipe header.
      { selector: '.mm-recipes-save-button-placeholder', resolve: 'self' },
      // Roundup/listicle pages: one save container per recipe card.
      { selector: '.mm-myrecipes-favorite', resolve: 'self' },
      { selector: '[data-tracking-subtype="Recipe Save"]', resolve: 'self' },
      { selector: '[data-tracking-subtype$="Save Recipe"]', resolve: 'self' },
      // Icon-level fallback for older markup.
      { selector: '.save-icon-favorite', resolve: 'closest-control' },
    ],
    // Header/utility nav ("My Saves" → user's saved list) and login triggers.
    exclude: 'nav, .mntl-utility-nav, .myr-login-trigger, [aria-label="Go to MyRecipes"]',
  },
];

/** A roundup-card save button points at a different recipe than the page itself. */
export interface CardRecipeRef {
  url: string;
  title: string | null;
}

export function targetsForHost(hostname: string): CompetitorTarget | undefined {
  return COMPETITOR_TARGETS.find((t) =>
    t.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`)),
  );
}

import { createLogoNode } from './logo';
import { burstConfettiFrom } from './confetti';

const OVERLAY_STYLES = `
:host { all: initial; }
.overlay {
  position: fixed;
  z-index: 2147483646;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #1db954;
  color: #fff;
  border: none;
  border-radius: 0;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.overlay.visible { display: flex; }
.overlay:hover { filter: brightness(1.05); }
.overlay svg, .overlay img { width: 18px; height: 18px; flex: none; }
.overlay span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.overlay { overflow: hidden; box-sizing: border-box; padding: 0 4px; }
`;

type OverlaySaveHandler = (card: CardRecipeRef | null) => Promise<'saved' | 'duplicate' | 'error'>;

type LabelMode = 'full' | 'short' | 'icon';

interface Covered {
  target: Element;
  button: HTMLButtonElement;
  mode: LabelMode;
  /** Last label text so a mode change can re-render it. */
  text: string;
}

/**
 * The visible control's rect. Placeholder wrappers can be styled smaller than
 * the button that hydrates inside them — cover whichever is larger.
 */
function controlRect(target: Element): DOMRect {
  let rect = target.getBoundingClientRect();
  const inner = target.querySelector('button, a, [role="button"]');
  if (inner) {
    const innerRect = inner.getBoundingClientRect();
    if (innerRect.width * innerRect.height > rect.width * rect.height) rect = innerRect;
  }
  return rect;
}

function modeForWidth(width: number): LabelMode {
  if (width < 80) return 'icon';
  if (width < 160) return 'short';
  return 'full';
}

/**
 * On roundup pages each save container carries the card's recipe URL + title
 * in tracking attributes. Absent (recipe pages) → null → save the page itself.
 */
export function cardRecipeFor(target: Element, pageUrl: string): CardRecipeRef | null {
  const carrier = target.closest('[data-tracking-target-url]');
  const url = carrier?.getAttribute('data-tracking-target-url')?.trim();
  if (!url || !/^https?:\/\//.test(url)) return null;
  const canonical = (u: string): string => u.split('#')[0]?.split('?')[0] ?? u;
  if (canonical(url) === canonical(pageUrl)) return null;
  return { url, title: carrier?.getAttribute('data-tracking-metadata-label')?.trim() || null };
}

export class CompetitorOverlay {
  private onSave: OverlaySaveHandler;
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private covered: Covered[] = [];
  private seen = new WeakSet<Element>();
  private selectors: CompetitorSelector[];
  private exclude: string;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private repositionQueued = false;

  constructor(target: CompetitorTarget, onSave: OverlaySaveHandler) {
    this.onSave = onSave;
    this.selectors = target.selectors;
    this.exclude = target.exclude;
    this.host = document.createElement('pepper-competitor-overlay');
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.shadow.appendChild(style);
  }

  start(): void {
    document.documentElement.appendChild(this.host);
    this.scan();
    // Their save buttons hydrate late — rescan on DOM churn (debounced).
    new MutationObserver(() => {
      if (this.rescanTimer) clearTimeout(this.rescanTimer);
      this.rescanTimer = setTimeout(() => {
        this.scan();
        this.reposition();
      }, 400);
    }).observe(document.documentElement, { childList: true, subtree: true });

    const queueReposition = (): void => {
      if (this.repositionQueued) return;
      this.repositionQueued = true;
      requestAnimationFrame(() => {
        this.repositionQueued = false;
        this.reposition();
      });
    };
    window.addEventListener('scroll', queueReposition, { capture: true, passive: true });
    window.addEventListener('resize', queueReposition, { passive: true });
  }

  private scan(): void {
    for (const { selector, resolve } of this.selectors) {
      let matches: NodeListOf<Element>;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const match of matches) {
        const target =
          resolve === 'closest-control'
            ? (match.closest('button, a, [role="button"]') ?? match)
            : match;
        if (this.seen.has(target)) continue;
        this.seen.add(target);
        if (this.exclude && target.closest(this.exclude)) continue; // e.g. "My Saves" nav
        this.cover(target);
      }
    }
  }

  private cover(target: Element): void {
    const button = document.createElement('button');
    button.className = 'overlay';
    button.setAttribute('aria-label', 'Save to Pepper');
    const covered: Covered = { target, button, mode: 'full', text: 'Save to Pepper' };
    this.renderLabel(covered, 'Save to Pepper');
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.handleClick(covered, cardRecipeFor(target, location.href));
    });
    this.shadow.appendChild(button);
    this.covered.push(covered);
    new ResizeObserver(() => this.reposition()).observe(target);
    this.reposition();
  }

  private async handleClick(covered: Covered, card: CardRecipeRef | null): Promise<void> {
    this.renderLabel(covered, 'Saving…');
    const result = await this.onSave(card);
    this.renderLabel(
      covered,
      result === 'saved' ? '✓ Saved' : result === 'duplicate' ? '✓ Already saved' : 'Try again',
    );
    if (result === 'saved') burstConfettiFrom(covered.button);
    setTimeout(() => this.renderLabel(covered, 'Save to Pepper'), 2000);
  }

  private renderLabel(covered: Covered, text: string): void {
    const { button, mode } = covered;
    covered.text = text;
    button.replaceChildren(createLogoNode());
    if (mode !== 'icon') {
      const span = document.createElement('span');
      // Narrow targets get the short forms so the label never wraps.
      span.textContent =
        mode === 'short'
          ? text === 'Save to Pepper'
            ? 'Save'
            : text === '✓ Already saved'
              ? '✓ Saved'
              : text
          : text;
      button.appendChild(span);
    }
    button.title = text;
  }

  private reposition(): void {
    for (const covered of this.covered) {
      const { target, button } = covered;
      if (!target.isConnected) {
        button.classList.remove('visible');
        continue;
      }
      const rect = controlRect(target);
      if (rect.width < 8 || rect.height < 8) {
        button.classList.remove('visible');
        continue;
      }
      const mode = modeForWidth(rect.width);
      if (mode !== covered.mode) {
        covered.mode = mode;
        this.renderLabel(covered, covered.text);
      }
      button.classList.add('visible');
      button.style.top = `${rect.top}px`;
      button.style.left = `${rect.left}px`;
      button.style.width = `${rect.width}px`;
      button.style.height = `${rect.height}px`;
    }
  }
}
