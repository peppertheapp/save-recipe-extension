import { renderLogo } from './logo';
import { burstConfettiFrom } from './confetti';
import type { ExtractedRecipe } from '../shared/types';

export type ButtonState = 'green' | 'saving' | 'saved' | 'duplicate' | 'error';

export interface ButtonCallbacks {
  onSave: () => void;
  /** Open the saved-recipe inspector (details button, shown once saved). */
  onShowDetails: () => void;
  onPositionChange: (pos: { right: number; bottom: number }) => void;
}

export interface SavedRecipeDetails {
  recipe: ExtractedRecipe;
  savedAt: number;
}

const STYLES = `
:host { all: initial; }
.wrap {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.btn {
  display: flex; align-items: center; justify-content: center;
  width: 52px; height: 52px; border-radius: 50%;
  border: none; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
  transition: transform .15s ease, background .2s ease, opacity .2s ease;
  color: #fff;
}
.btn svg, .btn img.logo { width: 30px; height: 30px; }
.btn img.logo { object-fit: contain; }
.btn:hover { transform: scale(1.08); }
.btn.green, .btn.saving, .btn.saved, .btn.duplicate { background: #ff5f50; }
.btn.error { background: #d93025; animation: shake .4s; }
@keyframes shake {
  0%,100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}
.spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 3px solid rgba(255,255,255,.35); border-top-color: #fff;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.check { font-size: 24px; font-weight: 700; }
.details-btn {
  display: none;
  align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 50%;
  border: 2px solid #ff5f50; background: #fff; color: #ff5f50;
  cursor: pointer; font-size: 17px; font-weight: 700;
  box-shadow: 0 3px 10px rgba(0,0,0,.2);
  transition: transform .15s ease;
}
.details-btn.visible { display: flex; }
.details-btn:hover { transform: scale(1.08); }
.label {
  position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%);
  background: #222; color: #fff; padding: 6px 10px; border-radius: 6px;
  font-size: 13px; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity .15s ease;
}
.wrap:hover .label.hoverable { opacity: 1; }
.label.forced { opacity: 1; pointer-events: auto; }
.panel {
  position: absolute; right: 0; bottom: 62px;
  width: 330px; max-height: 65vh; overflow-y: auto;
  background: #fff; color: #222; border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,.3);
  font-size: 13px; line-height: 1.45;
}
.panel-header {
  position: sticky; top: 0;
  display: flex; align-items: center; gap: 8px;
  background: #ff5f50; color: #fff; padding: 10px 12px;
  font-size: 14px; font-weight: 700;
}
.panel-header .title { flex: 1; }
.panel-header button {
  background: none; border: none; color: #fff; font-size: 16px; cursor: pointer; padding: 2px 6px;
}
.panel-body { padding: 12px; }
.panel-body img { max-width: 100%; border-radius: 6px; margin-bottom: 8px; }
.panel-body .meta { color: #666; font-size: 12px; margin-bottom: 8px; }
.panel-body h4 { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #ff5f50; }
.panel-body ul, .panel-body ol { margin: 0; padding-left: 18px; }
.panel-body li { margin-bottom: 3px; }
.panel-body .desc { white-space: pre-wrap; color: #444; }
.panel-body .empty { color: #999; font-style: italic; }
.panel-body a { color: #e0402f; word-break: break-all; }
`;

export class PepperButton {
  private host: HTMLElement;
  private wrap: HTMLElement;
  private btn: HTMLButtonElement;
  private detailsBtn: HTMLButtonElement;
  private label: HTMLElement;
  private panel: HTMLElement | null = null;
  private state: ButtonState = 'green';
  private savedState = false;
  private callbacks: ButtonCallbacks;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: ButtonCallbacks) {
    this.callbacks = callbacks;
    this.host = document.createElement('pepper-recipe-importer');
    const shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    this.wrap = document.createElement('div');
    this.wrap.className = 'wrap';
    this.detailsBtn = document.createElement('button');
    this.detailsBtn.className = 'details-btn';
    this.detailsBtn.textContent = 'ⓘ';
    this.detailsBtn.title = 'View saved recipe details';
    this.detailsBtn.setAttribute('aria-label', 'View saved recipe details');
    this.detailsBtn.addEventListener('click', () => {
      if (this.panel) this.closePanel();
      else this.callbacks.onShowDetails();
    });
    this.btn = document.createElement('button');
    this.btn.className = 'btn green';
    this.btn.setAttribute('aria-label', 'Save to Pepper');
    this.label = document.createElement('div');
    this.label.className = 'label hoverable';
    this.wrap.append(this.detailsBtn, this.btn, this.label);
    shadow.appendChild(this.wrap);

    this.renderFace();
    this.attachInteractions();
  }

  mount(position: { right: number; bottom: number } | null): void {
    const pos = position ?? { right: 20, bottom: 20 };
    this.wrap.style.right = `${pos.right}px`;
    this.wrap.style.bottom = `${pos.bottom}px`;
    this.host.style.display = 'none'; // hidden until a recipe is detected
    document.documentElement.appendChild(this.host);
  }

  /** The button only exists on pages where there's something to save. */
  show(): void {
    this.host.style.display = '';
  }

  hide(): void {
    this.host.style.display = 'none';
    this.closePanel();
  }

  destroy(): void {
    this.host.remove();
  }

  /**
   * Already-imported recipes keep a persistent checkmark and expose the
   * details inspector; unsaved recipes show the logo.
   */
  setSaved(saved: boolean): void {
    this.savedState = saved;
    this.detailsBtn.classList.toggle('visible', saved);
    if (this.state !== 'saving') this.setState(saved ? 'saved' : 'green');
  }

  /** Confetti — called by the save flow on FRESH saves only. */
  celebrate(): void {
    burstConfettiFrom(this.btn);
  }

  setState(state: ButtonState, message?: string): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    this.state = state === 'duplicate' ? 'saved' : state;
    this.btn.className = `btn ${this.state}`;
    this.label.classList.remove('forced');
    this.renderFace(message);

    // Only errors are transient — saved is a persistent state now.
    if (this.state === 'error') {
      this.resetTimer = setTimeout(
        () => this.setState(this.savedState ? 'saved' : 'green'),
        2500,
      );
    }
  }

  /** Render the saved-record inspector (QA: verify what the import captured). */
  showDetails(details: SavedRecipeDetails | null): void {
    this.closePanel();
    const panel = document.createElement('div');
    panel.className = 'panel';

    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = details ? details.recipe.title : 'Not found';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closePanel());
    header.append(title, close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'panel-body';
    if (!details) {
      body.textContent = 'No saved record found for this page.';
    } else {
      const r = details.recipe;
      if (r.imageUrl) {
        const img = document.createElement('img');
        img.src = r.imageUrl;
        img.alt = '';
        body.appendChild(img);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      const bits = [
        r.author && `By ${r.author}`,
        r.yield && `Serves ${r.yield}`,
        r.totalTimeMinutes && `${r.totalTimeMinutes} min total`,
        `method: ${r.extractionMethod}`,
        `saved ${new Date(details.savedAt).toLocaleString()}`,
      ].filter(Boolean);
      meta.textContent = bits.join(' · ');
      body.appendChild(meta);

      body.appendChild(this.sectionList('Ingredients', r.ingredients, 'ul'));
      body.appendChild(this.sectionList('Instructions', r.instructions, 'ol'));

      if (r.description) {
        const h = document.createElement('h4');
        h.textContent = 'Caption / description';
        const p = document.createElement('p');
        p.className = 'desc';
        p.textContent = r.description.length > 600 ? `${r.description.slice(0, 597)}…` : r.description;
        body.append(h, p);
      }
      const h = document.createElement('h4');
      h.textContent = 'Source';
      const a = document.createElement('a');
      a.href = r.sourceUrl;
      a.textContent = r.sourceUrl;
      a.target = '_blank';
      a.rel = 'noreferrer';
      body.append(h, a);
    }
    panel.appendChild(body);
    this.wrap.appendChild(panel);
    this.panel = panel;
  }

  private sectionList(heading: string, items: string[], kind: 'ul' | 'ol'): DocumentFragment {
    const frag = document.createDocumentFragment();
    const h = document.createElement('h4');
    h.textContent = `${heading} (${items.length})`;
    frag.appendChild(h);
    if (items.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'none captured — backend will extract';
      frag.appendChild(p);
      return frag;
    }
    const list = document.createElement(kind);
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    frag.appendChild(list);
    return frag;
  }

  private closePanel(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private renderFace(message?: string): void {
    switch (this.state) {
      case 'green':
        renderLogo(this.btn);
        this.setLabel('Save to Pepper');
        break;
      case 'saving':
        this.btn.innerHTML = '<div class="spinner"></div>';
        this.setLabel('Saving…');
        break;
      case 'saved':
      case 'duplicate':
        this.btn.innerHTML = '<span class="check">✓</span>';
        this.setLabel('Saved to Pepper');
        break;
      case 'error':
        this.btn.innerHTML = '<span class="check">!</span>';
        this.setLabel(message ?? 'Something went wrong', true);
        break;
    }
  }

  private setLabel(text: string, forced = false): void {
    this.label.textContent = text;
    this.label.className = `label ${forced ? 'forced' : 'hoverable'}`;
  }

  private attachInteractions(): void {
    // Click vs drag: pointer events with a small movement threshold.
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startBottom = 0;
    let dragging = false;
    let moved = false;

    this.btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startRight = Number.parseFloat(this.wrap.style.right) || 20;
      startBottom = Number.parseFloat(this.wrap.style.bottom) || 20;
      this.btn.setPointerCapture(e.pointerId);
    });

    this.btn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      const right = Math.max(4, Math.min(window.innerWidth - 56, startRight - dx));
      const bottom = Math.max(4, Math.min(window.innerHeight - 56, startBottom - dy));
      this.wrap.style.right = `${right}px`;
      this.wrap.style.bottom = `${bottom}px`;
    });

    this.btn.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        this.callbacks.onPositionChange({
          right: Number.parseFloat(this.wrap.style.right),
          bottom: Number.parseFloat(this.wrap.style.bottom),
        });
        return;
      }
      if (this.state === 'green') this.callbacks.onSave();
      else if (this.state === 'saved') this.callbacks.onShowDetails();
    });
  }
}
