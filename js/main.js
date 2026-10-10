import { store } from './core/store.js';
import { sync } from './core/sync.js';
import * as cloud from './core/cloud.js';
import { initLock } from './core/lock.js';
import { logger, pruneLogs } from './core/log.js';
import { prefs } from './core/prefs.js';
import { $, icon, esc, closeSheet } from './ui.js';
import { openTxnSheet } from './modules/txn-sheet.js';
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
import { openAiAssistant } from './modules/ai.js';
import { getAiConfig } from './core/ai.js';
import { makeDraggable } from './core/draggable.js';

// Route map
const routes = {
  home:       { mod: home,       label: 'Home',       icon: 'home' },
  funds:      { mod: funds,      label: 'Funds',      icon: 'funds' },
  history:    { mod: history,    label: 'History',    icon: 'history' },
  metrics:    { mod: metrics,    label: 'Metrics',    icon: 'statements' },
  statements: { mod: statements, label: 'Statements', icon: 'statements' },
  recurring:  { mod: recurring,  label: 'Recurring',  icon: 'recurring' },
  chat:       { mod: chat,       label: 'Chat',       icon: 'chat' },
  manage:     { mod: manage,     label: 'Manage',     icon: 'manage' },
  audit:      { mod: audit,      label: 'Audit',      icon: 'audit' },
  logs:       { mod: logs,       label: 'Logs',       icon: 'logs' },
  settings:   { mod: settings,   label: 'Settings',   icon: 'settings', nav: false },
  account:    { mod: account,    label: 'Account',    icon: 'user', nav: false },
};

// Logical sections for Desktop Sidebar (Settings is accessed exclusively via top-left Gear icon)
const DESKTOP_NAV = [
  { section: 'Overview', keys: ['home', 'funds', 'history'] },
  { section: 'Insights', keys: ['metrics', 'statements', 'recurring'] },
  { section: 'Connect', keys: ['chat'] },
  { section: 'Tools', keys: ['manage', 'audit', 'logs'] },
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
  if (s.user?.photoURL) {
    dp.innerHTML = `<img src="${esc(s.user.photoURL)}" alt="${esc(s.user.displayName || 'Account')}" referrerpolicy="no-referrer">`;
  } else {
    const initial = (s.user?.displayName?.[0] || s.profile?.name?.[0] || store.live().profile?.name?.[0] || 'H').toUpperCase();
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

function updateAiFab() {
  const fab = $('#fab-ai');
  if (!fab) return;
  const cfg = getAiConfig();
  fab.hidden = !cfg.enabled;
}

function draw() {
  const { name, arg } = current();
  renderNav();
  updateDp();
  updateAiFab();
  routes[name].mod.render($('#view'), arg);
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

  if (e.key === 'n' || e.key === 'N' || e.key === '+') {
    e.preventDefault();
    openTxnSheet();
    return;
  }
});
addEventListener('hashchange', draw);
addEventListener('resize', renderNav);
store.subscribe(() => {
  updateDp();
  updateAiFab();
  if (current().name !== 'chat') draw();
});

// Initialize Draggable Floating Action Buttons with wall-snapping
makeDraggable($('#fab-add'), {
  id: 'add',
  defaultPos: { side: 'left' },
  onClick: () => openTxnSheet()
});

makeDraggable($('#fab-ai'), {
  id: 'ai',
  defaultPos: { side: 'right' },
  onClick: () => openAiAssistant()
});

initLock();
await store.init();
await store.runRecurring();
sync.schedule((k, d) => store.applyRemote(k, d, false));
draw();
logger.info('App started', { mode: prefs().mode, theme: prefs().theme });
pruneLogs();
if (cloud.configured()) {
  cloud.onChange(cloudChanged);
  cloud.init().then(cloudChanged).catch(e => logger.warn('Cloud init failed', { error: String(e) }));
}
