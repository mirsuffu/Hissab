// Tiny UI helpers shared by all modules.
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icons = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  funds: '<path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-3v3M16 14h2"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
};
export const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]}</svg>`;

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
export function openSheet(html, onMount) {
  const r = $('#sheet-root');
  r.innerHTML = `<div class="scrim" data-close></div><section class="sheet glass" role="dialog" aria-modal="true">${html}</section>`;
  requestAnimationFrame(() => r.classList.add('open'));
  r.onclick = e => { if (e.target.closest('[data-close]')) closeSheet(); };
  onMount?.(r.querySelector('.sheet'));
}
export function closeSheet() {
  const r = $('#sheet-root');
  r.classList.remove('open'); setTimeout(() => { if (!r.classList.contains('open')) r.innerHTML = ''; }, 260);
}
export const dot = hue => `<span class="dot" style="background:hsl(${hue} 60% 52%)"></span>`;
