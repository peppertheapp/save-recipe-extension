/**
 * Pepper button logo.
 *
 * Primary source: a PNG at public/icons/button-logo.png (white mark on a
 * transparent background). Drop your own file there and rebuild to swap it.
 * If that file is missing or fails to load, the button falls back to the
 * inline SVG trace below so it never renders empty.
 */

/**
 * A logo `<img>` node. If the PNG is missing or fails to load, it replaces
 * itself in place with the inline SVG trace. CSP-safe (no inline handlers).
 */
export function createLogoNode(): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'logo';
  img.alt = '';
  img.src = chrome.runtime.getURL('icons/button-logo.png');
  img.addEventListener('error', () => {
    const parent = img.parentElement;
    if (!parent) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'logo';
    wrapper.innerHTML = PEPPER_LOGO_SVG;
    parent.replaceChild(wrapper, img);
  });
  return img;
}

/** Renders the logo as the sole content of `container`. */
export function renderLogo(container: HTMLElement): void {
  container.innerHTML = '';
  container.appendChild(createLogoNode());
}

/** Inline fallback trace of the Pepper chili mark (white on transparent). */
export const PEPPER_LOGO_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="#fff" d="M12,80
    C18,66 34,52 56,38
    C60,34 64,31 68,30
    C74,28 81,31 82,38
    C83,48 74,62 56,73
    C40,82 22,88 13,84
    C9,82 10,84 12,80 Z"/>
  <path fill="#fff" d="M73,25
    C76,17 80,10 86,4
    C89,1 94,4 92,9
    C89,15 86,21 83,27
    C81,31 78,31 76,29
    C74,28 72,27 73,25 Z"/>
  <path fill="none" stroke="#1db954" stroke-width="3.5" stroke-linecap="round"
    d="M68,32 C74,28 78,26 82,24"/>
  <path fill="none" stroke="#1db954" stroke-width="3" stroke-linecap="round"
    d="M26,74 C44,66 58,55 68,42"/>
</svg>`;
