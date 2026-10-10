import { store } from './core/store.js';
import { sync } from './core/sync.js';
import * as cloud from './core/cloud.js';
import { initLock } from './core/lock.js';
import { logger, pruneLogs } from './core/log.js';
import { prefs } from './core/prefs.js';
import { $, icon, esc } from './ui.js';
import { openTxnSheet } from './modules/txn-sheet.js';
import * as home from './modules/dashboard.js';
import * as funds from './modules/funds.js';
import * as history from './modules/history.js';
import * as chat from './modules/chat.js';
import * as settings from './modules/settings.js';
import * as manage from './modules/manage.js';
import * as audit from './modules/audit.js';
import * as logs from './modules/logs.js';
import * as statements from './modules/statements.js';
import * as recurring from './modules/recurring.js';
import * as account from './modules/account.js';
import { openAiAssistant } from './modules/ai.js';
import { makeDraggable } from './core/draggable.js';

// Route map
const routes = {
  home:       { mod: home,       label: 'Home',       icon: 'home' },
  funds:      { mod: funds,      label: 'Funds',      icon: 'funds' },
  history:    { mod: history,    label: 'History',    icon: 'history' },
  statements: { mod: statements, label: 'Statements', icon: 'statements' },
  recurring:  { mod: recurring,  label: 'Recurring',  icon: 'recurring' },
  chat:       { mod: chat,       label: 'Chat',       icon: 'chat' },
  manage:     { mod: manage,     label: 'Manage',     icon: 'manage' },
  audit:      { mod: audit,      label: 'Audit',      icon: 'audit' },
  logs:       { mod: logs,       label: 'Logs',       icon: 'logs' },
  settings:   { mod: settings,   label: 'Settings',   icon: 'settings' },
  account:    { mod: account,    label: 'Account',    icon: 'user', nav: false },
};

// Logical sections for Desktop Sidebar
const DESKTOP_NAV = [
  { section: 'Overview', keys: ['home', 'funds', 'history'] },
  { section: 'Insights', keys: ['statements', 'recurring'] },
  { section: 'Connect', keys: ['chat'] },
  { section: 'Tools', keys: ['manage', 'audit', 'logs', 'settings'] },
];

// Core tabs for Mobile Bottom Bar
const MOBILE_NAV_KEYS = ['home', 'funds', 'history', 'chat', 'settings'];

const NAV_OF = {
  manage: 'settings',
  audit: 'settings',
  logs: 'settings',
  statements: 'settings',
  recurring: 'settings',
  account: 'settings'
};

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
    const on = routes[name]?.nav !== false && MOBILE_NAV_KEYS.includes(name) ? name : (NAV_OF[name] || 'home');
    nav.innerHTML = MOBILE_NAV_KEYS.map(k => {
      const r = routes[k];
      const active = (k === on) ? 'on' : '';
      return `<a href="#/${k}" class="${active}">${icon(r.icon)}<span>${r.label}</span>${k === 'chat' ? badge() : ''}</a>`;
    }).join('');
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
  dp.title = s.user ? `Account (${s.user.displayName || s.user.email || 'Online'})` : 'Account (Local)';
}

function draw() {
  const { name, arg } = current();
  renderNav();
  updateDp();
  routes[name].mod.render($('#view'), arg);
}

function setBadge() {
  const b = $('[data-badge]');
  if (b) {
    b.textContent = unread;
    b.hidden = !unread;
  }
}

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
addEventListener('hashchange', draw);
addEventListener('resize', renderNav);
store.subscribe(() => {
  updateDp();
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
draw();
logger.info('App started', { mode: prefs().mode, theme: prefs().theme });
pruneLogs();
if (cloud.configured()) {
  cloud.onChange(cloudChanged);
  cloud.init().then(cloudChanged).catch(e => logger.warn('Cloud init failed', { error: String(e) }));
}
