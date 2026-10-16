// Tiny UI helpers shared by all modules.
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icons = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  funds: '<path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-3v3M16 14h2"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  ai: '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/><path d="M19 3v4M21 5h-4M5 19v2M6 20H4"/>',
  statements: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  recurring: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  audit: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  logs: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  manage: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/>',
  pot: '<path d="M6 10a6 6 0 1 0 12 0c0-2.5-1.8-3.5-3-4.5V4H9v1.5C7.8 6.5 6 7.5 6 10zM8 20h8"/>',
  reconcile: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><path d="M17 8H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  suspense: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
};
export const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n] || ''}</svg>`;

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
export function openSheet(html, onMount) {
  document.body.classList.add('sheet-open');
  const r = $('#sheet-root');
  r.innerHTML = `<div class="scrim" data-close></div><section class="sheet glass" role="dialog" aria-modal="true">${html}</section>`;
  requestAnimationFrame(() => r.classList.add('open'));
  r.onclick = e => { if (e.target.closest('[data-close]')) closeSheet(); };
  if (!history.state?.hisaabSheet) {
    try { history.pushState({ hisaabSheet: true }, ''); } catch {}
  }
  onMount?.(r.querySelector('.sheet'));
}

export function closeSheet(fromPopState = false) {
  document.body.classList.remove('sheet-open');
  const r = $('#sheet-root');
  if (r.classList.contains('open') && !fromPopState && history.state?.hisaabSheet) {
    try { history.back(); } catch {}
  }
  r.classList.remove('open');
  setTimeout(() => { if (!r.classList.contains('open')) r.innerHTML = ''; }, 300);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const r = $('#sheet-root');
    if (r?.classList.contains('open')) {
      closeSheet(true);
    } else {
      document.body.classList.remove('sheet-open');
    }
  });
}

export const dot = hue => `<span class="dot" style="background:hsl(${hue} 60% 52%)"></span>`;

/* ---- In-App Native Custom Dialogs (Zero Browser Defaults, Dedicated Layer) ---- */
function getDialogRoot() {
  let d = document.getElementById('dialog-root');
  if (!d) {
    d = document.createElement('div');
    d.id = 'dialog-root';
    document.body.appendChild(d);
  }
  return d;
}

export function confirmModal({ title = 'Confirm', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    let resolved = false;
    const root = getDialogRoot();
    let onKey = null;
    const finish = val => {
      if (resolved) return;
      resolved = true;
      if (onKey) window.removeEventListener('keydown', onKey);
      root.classList.remove('open');
      setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 250);
      resolve(val);
    };

    const alertClass = danger ? 'modal-alert' : '';
    const btnClass = danger ? 'btn danger' : 'btn primary';

    root.innerHTML = `
      <div class="scrim dialog-scrim" data-cancel style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:70;opacity:1"></div>
      <div class="dialog-box card glass ${alertClass}" role="dialog" aria-modal="true" style="position:fixed;top:50%;left:50%;transform:translate(-50%, -50%);z-index:75;width:min(380px, 92vw);padding:22px 20px;box-shadow:0 14px 40px rgba(0,0,0,0.4);border-radius:calc(var(--radius)*1.1)">
        <h2 class="dialog-title" style="margin:0 0 6px;font-size:1.2rem">${esc(title)}</h2>
        <p class="dialog-msg" style="margin:0 0 18px;font-size:.9rem;line-height:1.45">${esc(message)}</p>
        <div class="dialog-actions" style="display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn" data-cancel>${esc(cancelText)}</button>
          <button type="button" class="${btnClass}" data-ok autofocus>${esc(confirmText)}</button>
        </div>
      </div>
    `;
    requestAnimationFrame(() => root.classList.add('open'));

    root.querySelector('[data-ok]')?.addEventListener('click', () => finish(true));
    root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => finish(false)));
    onKey = e => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(true);
    };
    window.addEventListener('keydown', onKey);
  });
}

export function promptModal({ title = 'Input', message = '', placeholder = '', defaultValue = '', confirmText = 'Save', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    let resolved = false;
    const root = getDialogRoot();
    let onKey = null;
    const finish = val => {
      if (resolved) return;
      resolved = true;
      if (onKey) window.removeEventListener('keydown', onKey);
      root.classList.remove('open');
      setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 250);
      resolve(val);
    };

    root.innerHTML = `
      <div class="scrim dialog-scrim" data-cancel style="position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:70;opacity:1"></div>
      <form class="dialog-box card glass form" role="dialog" aria-modal="true" style="position:fixed;top:50%;left:50%;transform:translate(-50%, -50%);z-index:75;width:min(380px, 92vw);padding:22px 20px;box-shadow:0 14px 40px rgba(0,0,0,0.4);border-radius:calc(var(--radius)*1.1)">
        <h2 class="dialog-title" style="margin:0 0 6px;font-size:1.2rem">${esc(title)}</h2>
        ${message ? `<p class="dialog-msg" style="margin:0 0 14px;font-size:.9rem;line-height:1.4">${esc(message)}</p>` : ''}
        <input class="dialog-input" name="val" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(defaultValue)}" autofocus required>
        <div class="dialog-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button type="button" class="btn" data-cancel>${esc(cancelText)}</button>
          <button type="submit" class="btn primary">${esc(confirmText)}</button>
        </div>
      </form>
    `;
    requestAnimationFrame(() => root.classList.add('open'));

    const form = root.querySelector('form');
    const input = root.querySelector('input');
    form.onsubmit = e => {
      e.preventDefault();
      finish(input.value.trim());
    };
    root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => finish(null)));
    onKey = e => {
      if (e.key === 'Escape') finish(null);
    };
    window.addEventListener('keydown', onKey);
  });
}

// Neumorphic Toggle Switch HTML Component (Matches Reference Image)
export function toggleSwitch(name, checked, title, desc = '', dataAttr = '') {
  return `
    <div class="toggle-row">
      <div class="toggle-label">
        <span class="toggle-title">${esc(title)}</span>
        ${desc ? `<span class="toggle-desc">${esc(desc)}</span>` : ''}
      </div>
      <label class="toggle-switch">
        <input type="checkbox" name="${esc(name)}" ${dataAttr} ${checked ? 'checked' : ''}>
        <div class="toggle-track">
          <div class="toggle-thumb"></div>
        </div>
      </label>
    </div>
  `;
}

