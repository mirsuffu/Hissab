import { store } from './core/store.js';
import { sync } from './core/sync.js';
import * as cloud from './core/cloud.js';
import { initLock } from './core/lock.js';
import { logger, pruneLogs } from './core/log.js';
import { prefs } from './core/prefs.js';
import { $, icon, esc, closeSheet, toast, openSheet } from './ui.js';
import { openTxnSheet, openQuickExpense } from './modules/txn-sheet.js';
import * as home from './modules/dashboard.js';
import * as funds from './modules/funds.js';
import * as history from './modules/history.js';
import * as metrics from './modules/metrics.js';
import * as chat from './modules/chat.js';
import * as settings from './modules/settings.js';
import * as manage from './modules/manage.js';
import * as audit from './modules/audit.js';
import * as logs from './modules/logs.js';
import * as statements from './modules/statements.js';
import * as recurring from './modules/recurring.js';
import * as account from './modules/account.js';
import * as pots from './modules/pots.js';
import * as suspense from './modules/suspense.js';
import { getAiConfig } from './core/prefs.js';
const openAiAssistant = async () => {
  const mod = await import('./modules/ai.js');
  mod.openAiAssistant();
};
import { makeDraggable } from './core/draggable.js';
import { initSoundListener } from './core/sound.js';

// Route map
const routes = {
  home:       { mod: home,       label: 'Home',       icon: 'home' },
  funds:      { mod: funds,      label: 'Funds',      icon: 'funds' },
  pots:       { mod: pots,       label: 'Pots',       icon: 'pot' },
  history:    { mod: history,    label: 'History',    icon: 'history' },
  metrics:    { mod: metrics,    label: 'Metrics',    icon: 'statements' },
  statements: { mod: statements, label: 'Statements', icon: 'statements' },
  recurring:  { mod: recurring,  label: 'Recurring',  icon: 'recurring' },
  chat:       { mod: chat,       label: 'Chat',       icon: 'chat' },
  manage:     { mod: manage,     label: 'Manage',     icon: 'manage' },
  audit:      { mod: audit,      label: 'Audit',      icon: 'audit' },
  logs:       { mod: logs,       label: 'Logs',       icon: 'logs' },
  suspense:   { mod: suspense,   label: 'Suspense',   icon: 'suspense', nav: false },
  settings:   { mod: settings,   label: 'Settings',   icon: 'settings', nav: false },
  account:    { mod: account,    label: 'Account',    icon: 'user', nav: false },
};

// Logical sections for Desktop Sidebar (Settings is accessed exclusively via top-left Gear icon)
const DESKTOP_NAV = [
  { section: 'Overview', keys: ['home', 'funds', 'pots', 'history'] },
  { section: 'Insights', keys: ['metrics', 'statements', 'recurring'] },
  { section: 'Connect', keys: ['chat'] },
  { section: 'Tools', keys: ['manage', 'audit', 'logs', 'suspense'] },
];

let unread = 0;

const current = () => {
  const [, name = 'home', arg] = location.hash.split('/');
  return { name: routes[name] ? name : 'home', arg };
};

const badge = () => (unread ? `<i class="badge" data-badge>${unread}</i>` : '<i class="badge" data-badge hidden></i>');

function renderNav() {
  const { name } = current();
  const isDesktop = window.innerWidth >= 900;
  const nav = $('#nav');
  if (!nav) return;

  const currentMode = isDesktop ? 'desktop' : 'mobile';
  if (nav.dataset.mode === currentMode) {
    for (const a of nav.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const key = href.replace(/^#\//, '').split('/')[0];
      a.classList.toggle('on', key === name);
    }
    return;
  }

  nav.dataset.mode = currentMode;
  if (isDesktop) {
    let html = '';
    for (const sec of DESKTOP_NAV) {
      html += `<div class="nav-section">${sec.section}</div>`;
      for (const k of sec.keys) {
        const r = routes[k];
        const on = (k === name) ? 'on' : '';
        html += `<a href="#/${k}" class="${on}">${icon(r.icon)}<span>${r.label}</span>${k === 'chat' ? badge() : ''}</a>`;
      }
      html += `<div class="nav-sep"></div>`;
    }
    nav.innerHTML = html;
  } else {
    // Mobile bottom navigation: 5 slots [Home] [Funds] [Docked Add Entry] [History] [Chat]
    const homeOn = name === 'home' ? 'on' : '';
    const fundsOn = name === 'funds' ? 'on' : '';
    const historyOn = name === 'history' ? 'on' : '';
    const chatOn = name === 'chat' ? 'on' : '';

    nav.innerHTML = `
      <a href="#/home" class="${homeOn}">${icon('home')}<span>Home</span></a>
      <a href="#/funds" class="${fundsOn}">${icon('funds')}<span>Funds</span></a>
      <button class="nav-add-btn" data-add aria-label="Add entry" title="Add entry">${icon('plus')}</button>
      <a href="#/history" class="${historyOn}">${icon('history')}<span>History</span></a>
      <a href="#/chat" class="${chatOn}">${icon('chat')}<span>Chat</span>${badge()}</a>
    `;
  }
}

function updateDp() {
  const s = cloud.state();
  const dp = $('#user-dp');
  if (!dp) return;
  const p = store.live().profile;
  const avatarSrc = p?.dp || s.user?.photoURL;
  if (avatarSrc) {
    dp.innerHTML = `<img src="${esc(avatarSrc)}" alt="Avatar" referrerpolicy="no-referrer">`;
  } else {
    const initial = (p?.name?.[0] || s.profile?.name?.[0] || s.user?.displayName?.[0] || 'H').toUpperCase();
    dp.innerHTML = `<span class="dp-initials">${esc(initial)}</span>`;
  }

  // Update online/offline ring status
  if (!navigator.onLine) {
    dp.classList.add('offline');
  } else {
    dp.classList.remove('offline');
  }

  dp.title = s.user ? `Account (${s.user.displayName || s.user.email || 'Online'})` : 'Account (Local / Guest)';
}

function updateSyncChip() {
  const chip = $('#sync-chip');
  if (!chip) return;
  const s = sync.state();
  chip.className = `sync-chip ${s.code}`;
  chip.title = `Sync: ${s.label} (Tap for details)`;
  const textEl = chip.querySelector('.sync-chip-text');
  if (textEl) textEl.textContent = s.label;
}
sync.onSyncActivity(updateSyncChip);

$('#sync-chip')?.addEventListener('click', () => {
  const s = sync.state();
  const desc = s.code === 'synced'
    ? 'All transactions and records are securely synced! ☁️✨'
    : (s.code === 'pending'
      ? `You have ${s.pending} record(s) queued for sync as soon as network permits! ⏳⚡`
      : (s.code === 'offline'
        ? 'Currently offline. All records are safely preserved in local IndexedDB and will sync once reconnected. 📶🛡️'
        : 'Running in local mode. Sign in to your Google Account to enable automatic cloud backup! 💻🔐'));
  openSheet(`
    <div style="display:grid;gap:14px;text-align:center;padding:8px 0">
      <div style="font-size:2.4rem">${s.icon}</div>
      <h2 style="margin:0">Sync Status: ${s.label}</h2>
      <p style="margin:0;color:var(--ink-2);font-size:.9rem;line-height:1.4">${desc}</p>
      <div class="row" style="justify-content:center;margin-top:6px">
        <button type="button" class="btn primary" id="btn-sync-flush">⚡ Sync Now</button>
        <a href="#/account" class="btn" id="btn-sync-acct">Account Details</a>
      </div>
    </div>
  `, sheetEl => {
    sheetEl.querySelector('#btn-sync-flush')?.addEventListener('click', async () => {
      closeSheet();
      toast('Flushing sync queue… hold onto your chai! ☕🚀');
      await sync.flush();
      updateSyncChip();
      toast('Sync pipeline refreshed! ✨');
    });
    sheetEl.querySelector('#btn-sync-acct')?.addEventListener('click', () => closeSheet());
  });
});

// Native app feel: disable context menu globally, except on inputs/textareas
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

// Native app feel: block desktop & mobile zoom
window.addEventListener('wheel', e => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
    e.preventDefault();
  }
});

document.addEventListener('gesturestart', e => e.preventDefault());

// Native app feel: block mobile pinch-to-zoom while preserving single-touch gestures & pull-to-refresh
document.addEventListener('touchstart', e => {
  if (e.touches && e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

function updateAiFab() {
  const fab = $('#fab-ai');
  if (!fab) return;
  const cfg = getAiConfig();
  fab.hidden = !cfg.enabled;
}

function renderCurrentView() {
  const { name, arg } = current();
  renderNav();
  updateDp();
  updateAiFab();
  routes[name].mod.render($('#view'), arg);
}

function draw(isNavigation = false) {
  if (isNavigation && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try {
      const vt = document.startViewTransition(() => renderCurrentView());
      vt.ready?.catch?.(() => {});
      vt.finished?.catch?.(() => {});
    } catch {
      renderCurrentView();
    }
  } else {
    renderCurrentView();
  }
}

function setBadge() {
  const b = $('[data-badge]');
  if (b) {
    b.textContent = unread;
    b.hidden = !unread;
  }
}

// Online / Offline listeners for the status ring
window.addEventListener('online', () => {
  const dp = $('#user-dp');
  if (dp) dp.classList.remove('offline');
});
window.addEventListener('offline', () => {
  const dp = $('#user-dp');
  if (dp) dp.classList.add('offline');
});

// Sync activity ring blinking animation (3 pulses)
sync.onSyncActivity(() => {
  const dp = $('#user-dp');
  if (!dp) return;
  dp.classList.remove('syncing');
  void dp.offsetWidth; // retrigger CSS animation
  dp.classList.add('syncing');
  setTimeout(() => dp.classList.remove('syncing'), 1600);
});

// Signed in / out, sync, and the global unread counter.
let syncUid = '', unwatch = null, seen = {};
async function cloudChanged() {
  const s = cloud.state();
  try {
    if (s.user && localStorage.getItem('hisaab.syncOn') === '1' && syncUid !== s.user.uid) {
      syncUid = s.user.uid;
      await sync.connect(cloud.syncAdapter());
      await sync.pushAll(store.allDocs());
      await sync.pull((k, d) => store.applyRemote(k, d, false));
      sync.schedule((k, d) => store.applyRemote(k, d, false));
      store.touch();
    } else if (!s.user && syncUid) {
      syncUid = '';
      sync.disconnect();
    }
  } catch (e) {
    logger.warn('Cloud sync setup failed', { error: String(e) });
    syncUid = '';
  }
  unwatch?.();
  unwatch = null;
  unread = 0;
  if (s.user && s.profile) unwatch = cloud.watchChats(chats => {
    const me = s.user.uid;
    unread = chats.reduce((n, c) => n + (c.unread?.[me] || 0), 0);
    setBadge();
    for (const c of chats) {
      const n = c.unread?.[me] || 0;
      if (n > (seen[c.id] || 0) && seen[c.id] !== undefined && localStorage.getItem('hisaab.notify') === '1' && globalThis.Notification?.permission === 'granted' && location.hash !== `#/chat/${c.members.find(m => m !== me)}`)
        new Notification(c.names?.[c.members.find(m => m !== me)] || 'New message', { body: c.lastMessage?.text || '' });
      seen[c.id] = n;
    }
  });
  updateDp();
  draw();
}

addEventListener('error', e => logger.error('Unhandled error', { message: e.message, at: `${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', e => logger.error('Unhandled promise rejection', { reason: String(e.reason) }));
document.addEventListener('click', e => { if (e.target.closest('[data-add]')) openTxnSheet(); });

// Global desktop keyboard shortcuts (Ctrl+K or / for AI, N or + for Add Entry, Esc to close)
window.addEventListener('keydown', e => {
  if (document.getElementById('lock')) return;
  const isInput = e.target?.matches?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    closeSheet();
    return;
  }
  if (isInput) return;

  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
    e.preventDefault();
    openAiAssistant();
    return;
  }

  if (e.key === 'N') {
    e.preventDefault();
    openQuickExpense();
    return;
  }

  if (e.key === 'n' || e.key === '+') {
    e.preventDefault();
    openTxnSheet();
    return;
  }
});
addEventListener('hashchange', () => draw(true));
let lastWidth = window.innerWidth;
addEventListener('resize', () => {
  const newWidth = window.innerWidth;
  const crossedBreakpoint = (lastWidth < 900 && newWidth >= 900) || (lastWidth >= 900 && newWidth < 900);
  if (crossedBreakpoint) {
    lastWidth = newWidth;
    const nav = $('#nav');
    if (nav) nav.dataset.mode = '';
    renderNav();
  }
});
function syncWithNativeBridge() {
  if (!window.AndroidBridge) return;
  try {
    const { funds, txns } = store.live();
    const mine = (funds || []).filter(f => f.type !== 'held');
    const totalBal = mine.reduce((acc, f) => acc + (f.opening || 0), 0) +
      (txns || []).filter(t => {
        const f = (funds || []).find(x => x.id === t.fundId);
        return f && f.type !== 'held';
      }).reduce((acc, t) => acc + (t.kind === 'income' ? t.amount : -t.amount), 0);

    const todayIso = new Date().toISOString().slice(0, 10);
    const todayExp = (txns || [])
      .filter(t => t.date === todayIso && t.kind === 'expense')
      .reduce((acc, t) => acc + t.amount, 0);

    const fmtBal = '₹' + Math.round(totalBal).toLocaleString('en-IN');
    const fmtExp = '₹' + Math.round(todayExp).toLocaleString('en-IN');

    if (window.AndroidBridge.updateNotification) {
      window.AndroidBridge.updateNotification(fmtExp, fmtBal);
    }
    if (window.AndroidBridge.updateWidget) {
      window.AndroidBridge.updateWidget(JSON.stringify({
        totalBalance: fmtBal,
        todayExpense: fmtExp
      }));
    }
  } catch (err) {
    console.warn('Native bridge sync error:', err);
  }
}

window.hisaabAction = function(action) {
  if (action === 'add_expense' || action === 'add_txn' || action === 'add') {
    openTxnSheet();
  } else if (action === 'quick_expense' || action === 'quick') {
    openQuickExpense();
  } else if (action === 'ai') {
    openAiAssistant();
  }
};

store.subscribe(() => {
  updateDp();
  updateSyncChip();
  updateAiFab();
  syncWithNativeBridge();
  if (current().name !== 'chat') draw();
});

// Initialize Draggable Floating Action Buttons with wall-snapping
makeDraggable($('#fab-add'), {
  id: 'add',
  defaultPos: { side: 'left' },
  onClick: () => openTxnSheet(),
  onLongPress: () => openQuickExpense()
});

makeDraggable($('#fab-ai'), {
  id: 'ai',
  defaultPos: { side: 'right' },
  onClick: () => openAiAssistant()
});

initLock();
initSoundListener();
await store.init();
updateSyncChip();
const recCount = await store.runRecurring();
if (recCount > 0) {
  toast(`📅 Auto-pilot alert: ${recCount} recurring ${recCount === 1 ? 'entry was' : 'entries were'} posted! Like clockwork ⏰✨`);
}
sync.schedule((k, d) => store.applyRemote(k, d, false));
draw();
syncWithNativeBridge();

// Handle URL query parameter launch action if launched via web deep link
const launchAction = new URLSearchParams(window.location.search).get('action');
if (launchAction) {
  setTimeout(() => window.hisaabAction?.(launchAction), 350);
}

logger.info('App started', { mode: prefs().mode, theme: prefs().theme });
pruneLogs();

// Check recurring on tab refocus (overnight session date rollover)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) store.runRecurring().catch(() => {});
});

// Notify user when a new Service Worker version activates
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    import('./ui.js').then(ui => ui.toast('Hisaab updated · Tap to refresh'));
  });
}

if (cloud.configured()) {
  cloud.onChange(cloudChanged);
  cloud.init().then(cloudChanged).catch(e => logger.warn('Cloud init failed', { error: String(e) }));
}
