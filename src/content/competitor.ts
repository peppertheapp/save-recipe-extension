/**
 * Phase 4 — overlay module: on MyRecipes-network sites, a clearly-Pepper-branded
 * save button sits exactly on top of the site's save button and captures the
 * click. We never remove or modify their DOM nodes, never call their handlers,
 * and never mimic their visual design. Behavior is disclosed in the Chrome Web
 * Store listing (see docs/STORE_LISTING.md before shipping updates).
 */

export interface CompetitorTarget {
  domains: string[];
  /** Verified against live allrecipes.com markup 2026-07-09 — these WILL rot; re-check per release. */
  selectors: string[];
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
      '.mm-recipes-save-button-placeholder',
      '[data-tracking-subtype="Recipe Save"]',
      '.save-icon-favorite',
    ],
  },
];

export function targetsForHost(hostname: string): CompetitorTarget | undefined {
  return COMPETITOR_TARGETS.find((t) =>
    t.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`)),
  );
}

const PEPPER_SVG = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M13.5 5.5c0-1.5 1-2.5 2.5-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M12 22c-4.5 0-8-3.5-8-8.5C4 9 7 6.5 10.5 6.5c1.2 0 2.2.3 3 .8.8-.5 1.8-.8 3-.8C18.5 6.5 20 9 20 12c0 5.5-3.5 10-8 10z" fill="currentColor"/>
</svg>`;

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
  border-radius: 8px;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.overlay.visible { display: flex; }
.overlay:hover { filter: brightness(1.05); }
.overlay svg, .overlay img { width: 18px; height: 18px; }
`;

type OverlaySaveHandler = () => Promise<'saved' | 'duplicate' | 'error'>;

interface Covered {
  target: Element;
  button: HTMLButtonElement;
}

export class CompetitorOverlay {
  private onSave: OverlaySaveHandler;
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private covered: Covered[] = [];
  private seen = new WeakSet<Element>();
  private selectors: string[];
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private repositionQueued = false;

  constructor(target: CompetitorTarget, onSave: OverlaySaveHandler) {
    this.onSave = onSave;
    this.selectors = target.selectors;
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
    for (const selector of this.selectors) {
      let matches: NodeListOf<Element>;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const match of matches) {
        // Icon-level matches resolve up to the clickable control.
        const target = match.closest('button, a, [role="button"]') ?? match;
        if (this.seen.has(target)) continue;
        this.seen.add(target);
        this.cover(target);
      }
    }
  }

  private cover(target: Element): void {
    const button = document.createElement('button');
    button.className = 'overlay';
    button.setAttribute('aria-label', 'Save to Pepper');
    this.renderLabel(button, 'Save to Pepper');
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.handleClick(button);
    });
    this.shadow.appendChild(button);
    this.covered.push({ target, button });
    new ResizeObserver(() => this.reposition()).observe(target);
    this.reposition();
  }

  private async handleClick(button: HTMLButtonElement): Promise<void> {
    this.renderLabel(button, 'Saving…');
    const result = await this.onSave();
    this.renderLabel(
      button,
      result === 'saved' ? '✓ Saved' : result === 'duplicate' ? '✓ Already saved' : 'Try again',
    );
    setTimeout(() => this.renderLabel(button, 'Save to Pepper'), 2000);
  }

  private renderLabel(button: HTMLButtonElement, text: string): void {
    const compact = button.offsetWidth > 0 && button.offsetWidth < 110;
    button.innerHTML = `${PEPPER_SVG}${compact ? '' : `<span>${text}</span>`}`;
    button.title = text;
  }

  private reposition(): void {
    for (const { target, button } of this.covered) {
      if (!target.isConnected) {
        button.classList.remove('visible');
        continue;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        button.classList.remove('visible');
        continue;
      }
      button.classList.add('visible');
      button.style.top = `${rect.top}px`;
      button.style.left = `${rect.left}px`;
      button.style.width = `${rect.width}px`;
      button.style.height = `${rect.height}px`;
    }
  }
}
