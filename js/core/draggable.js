// Magnetic edge-snapping draggable floating action buttons.
// Supports mouse and touch pointer events, differentiates tap vs drag,
// and snaps smoothly to the nearest viewport wall on release.

export function makeDraggable(el, { id, defaultPos, onClick }) {
  if (!el) return;
  const KEY = `hisaab.fab_${id}`;
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(KEY)); } catch { pos = null; }
  if (!pos) pos = { ...defaultPos };

  let isDragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0, hasMoved = false;

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  const applyPos = (x, y, animate = false) => {
    el.style.transition = animate ? 'transform 0.38s cubic-bezier(0.18, 0.89, 0.32, 1.28)' : 'none';
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };

  const snapToWall = (curX, curY) => {
    const W = window.innerWidth, H = window.innerHeight;
    const rect = el.getBoundingClientRect();
    const pad = 20;
    const snapLeft = pad;
    const snapRight = Math.max(pad, W - rect.width - pad);

    // Closest horizontal wall
    const targetX = (curX + rect.width / 2 < W / 2) ? snapLeft : snapRight;
    // Clamp vertical bounds
    const topLimit = 64;
    const bottomLimit = Math.max(topLimit, H - rect.height - (W < 900 ? 84 : 28));
    const targetY = clamp(curY, topLimit, bottomLimit);

    applyPos(targetX, targetY, true);
    pos = { x: targetX, y: targetY, side: targetX === snapLeft ? 'left' : 'right' };
    localStorage.setItem(KEY, JSON.stringify(pos));
  };

  // Initialize position on screen
  const init = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const rect = el.getBoundingClientRect();
    const width = rect.width || (pos.side === 'right' ? 140 : 56);
    const height = rect.height || 56;
    const pad = 24;
    const defaultX = pos.side === 'left' ? pad : Math.max(pad, W - width - pad);
    const defaultY = Math.max(64, H - height - (W < 900 ? 84 : 32));
    const x = pos.x !== undefined ? clamp(pos.x, 10, W - width - 10) : defaultX;
    const y = pos.y !== undefined ? clamp(pos.y, 60, H - height - 10) : defaultY;
    applyPos(x, y, false);
    pos = { x, y, side: x + width / 2 < W / 2 ? 'left' : 'right' };
  };

  el.addEventListener('pointerdown', e => {
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    el.setPointerCapture?.(e.pointerId);
    el.style.transition = 'none';
    el.classList.add('dragging');
  });

  el.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!hasMoved && Math.hypot(dx, dy) > 5) {
      hasMoved = true;
    }
    if (hasMoved) {
      const nextX = initialX + dx;
      const nextY = initialY + dy;
      applyPos(nextX, nextY, false);
    }
  });

  const onEnd = e => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove('dragging');
    try { el.releasePointerCapture?.(e.pointerId); } catch {}

    if (!hasMoved) {
      onClick?.(e);
    } else {
      const rect = el.getBoundingClientRect();
      snapToWall(rect.left, rect.top);
    }
  };

  el.addEventListener('pointerup', onEnd);
  el.addEventListener('pointercancel', onEnd);

  window.addEventListener('resize', () => {
    const rect = el.getBoundingClientRect();
    snapToWall(rect.left, rect.top);
  });

  // Delay init so DOM layout is computed
  requestAnimationFrame(init);
}
