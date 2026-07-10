export type ButtonState = 'green' | 'saving' | 'saved' | 'duplicate' | 'error';

export interface ButtonCallbacks {
  onSave: () => void;
  onPositionChange: (pos: { right: number; bottom: number }) => void;
}

import { renderLogo } from './logo';

const STYLES = `
:host { all: initial; }
.wrap {
  position: fixed;
  z-index: 2147483647;
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
.btn.green { background: #1db954; }
.btn.saving { background: #1db954; }
.btn.saved, .btn.duplicate { background: #1db954; }
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
.label {
  position: absolute; right: 62px; top: 50%; transform: translateY(-50%);
  background: #222; color: #fff; padding: 6px 10px; border-radius: 6px;
  font-size: 13px; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: opacity .15s ease;
}
.wrap:hover .label.hoverable { opacity: 1; }
.label.forced { opacity: 1; pointer-events: auto; }
.label button {
  margin-left: 8px; background: #1db954; color: #fff; border: none;
  border-radius: 4px; padding: 3px 8px; font-size: 12px; cursor: pointer;
}
`;

export class PepperButton {
  private host: HTMLElement;
  private wrap: HTMLElement;
  private btn: HTMLButtonElement;
  private label: HTMLElement;
  private state: ButtonState = 'green';
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
    this.btn = document.createElement('button');
    this.btn.className = 'btn green';
    this.btn.setAttribute('aria-label', 'Save to Pepper');
    this.label = document.createElement('div');
    this.label.className = 'label hoverable';
    this.wrap.append(this.btn, this.label);
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
  }

  destroy(): void {
    this.host.remove();
  }

  setState(state: ButtonState, message?: string): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    this.state = state;
    this.btn.className = `btn ${state}`;
    this.label.classList.remove('forced');
    this.renderFace(message);

    // Transient states fall back to the underlying detection state after 2s.
    if (state === 'saved' || state === 'duplicate' || state === 'error') {
      this.resetTimer = setTimeout(() => this.setState('green'), 2000);
    }
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
        this.btn.innerHTML = '<span class="check">✓</span>';
        this.setLabel('Saved to Pepper', true);
        break;
      case 'duplicate':
        this.btn.innerHTML = '<span class="check">✓</span>';
        this.setLabel('Already saved', true);
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
    });
  }
}
