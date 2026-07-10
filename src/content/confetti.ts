/**
 * Confetti burst on successful saves. Self-contained: its own shadow host,
 * inline styles only (page CSP can't interfere), rAF-driven physics,
 * removes itself when done. Fires from the save button's location.
 */

const COLORS = ['#1db954', '#ea4025', '#ffd23f', '#ffffff', '#7ce3a1'];
const PARTICLE_COUNT = 44;
const DURATION_MS = 1300;
const GRAVITY = 0.32;

interface Particle {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
}

export function burstConfetti(originX: number, originY: number): void {
  const host = document.createElement('pepper-confetti');
  const shadow = host.attachShadow({ mode: 'closed' });
  const layer = document.createElement('div');
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
  shadow.appendChild(layer);
  document.documentElement.appendChild(host);

  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => {
    const el = document.createElement('div');
    const size = 5 + Math.random() * 5;
    const isRound = Math.random() < 0.3;
    el.style.cssText =
      `position:absolute;left:0;top:0;width:${size}px;` +
      `height:${isRound ? size : size * 0.45}px;` +
      `background:${COLORS[Math.floor(Math.random() * COLORS.length)]};` +
      `border-radius:${isRound ? '50%' : '1px'};will-change:transform,opacity;`;
    layer.appendChild(el);

    // Launch mostly upward in a cone; gravity brings them down past the button.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
    const speed = 5 + Math.random() * 8;
    return {
      el,
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 24,
    };
  });

  const start = performance.now();
  const tick = (now: number): void => {
    const elapsed = now - start;
    const fade = Math.max(0, 1 - elapsed / DURATION_MS);
    for (const p of particles) {
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.rotation}deg)`;
      p.el.style.opacity = String(fade);
    }
    if (elapsed < DURATION_MS) requestAnimationFrame(tick);
    else host.remove();
  };
  requestAnimationFrame(tick);
}

/** Burst from the center of an element (the button that was clicked). */
export function burstConfettiFrom(el: Element): void {
  const rect = el.getBoundingClientRect();
  burstConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
}
