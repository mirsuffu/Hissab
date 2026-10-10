import { store } from './core/store.js';
import { sync } from './core/sync.js';
import * as cloud from './core/cloud.js';
import { initLock } from './core/lock.js';
import { logger, pruneLogs } from './core/log.js';
import { prefs } from './core/prefs.js';
import { $, icon } from './ui.js';
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

// Adding a feature = add a module with render(root, arg) and one line here. nav:false = reachable by link only.
const routes = {
  home:     { mod: home,     label: 'Home',     icon: 'home' },
  funds:    { mod: funds,    label: 'Funds',    icon: 'funds' },
  history:  { mod: history,  label: 'History',  icon: 'history' },
  chat:     { mod: chat,     label: 'Chat',     icon: 'chat' },
  settings: { mod: settings, label: 'Settings', icon: 'settings' },
  manage:   { mod: manage,   nav: false },
  audit:    { mod: audit,    nav: false },
  logs:     { mod: logs,     nav: false },
  statements: { mod: statements, nav: false },
  recurring:  { mod: recurring,  nav: false },
};
const NAV_OF = { manage: 'settings', audit: 'settings', logs: 'settings', statements: 'settings', recurring: 'settings' };
let unread = 0;

const current = () => { const [, name = 'home', arg] = location.hash.split('/'); return { name: routes[name] ? name : 'home', arg }; };
const badge = () => (unread ? `<i class="badge" data-badge>${unread}</i>` : '<i class="badge" data-badge hidden></i>');

function draw() {
  const { name, arg } = current(), on = NAV_OF[name] || name, tabs = Object.entries(routes).filter(([, v]) => v.nav !== false);
  const link = ([k, v]) => `<a href="#/${k}" class="${k === on ? 'on' : ''}">${icon(v.icon)}<span>${v.label}</span>${k === 'chat' ? badge() : ''}</a>`;
  $('#nav').innerHTML = tabs.slice(0, 2).map(link).join('') + `<button class="add" data-add aria-label="Add entry">${icon('plus')}<span class="sr">Add entry</span></button>` + tabs.slice(2).map(link).join('');
  routes[name].mod.render($('#view'), arg);
}
function setBadge() { const b = $('[data-badge]'); if (b) { b.textContent = unread; b.hidden = !unread; } }

// Signed in / out, sync, and the global unread counter.
let syncUid = '', unwatch = null, seen = {};
async function cloudChanged() {
  const s = cloud.state();
  try {
    if (s.user && localStorage.getItem('hisaab.syncOn') === '1' && syncUid !== s.user.uid) {
      syncUid = s.user.uid; await sync.connect(cloud.syncAdapter());
      await sync.pushAll(store.allDocs()); await sync.pull((k, d) => store.applyRemote(k, d, false)); store.touch();
    }
  } catch (e) { logger.warn('Cloud sync setup failed', { error: String(e) }); syncUid = ''; }
  unwatch?.(); unwatch = null; unread = 0;
  if (s.user && s.profile) unwatch = cloud.watchChats(chats => {
    const me = s.user.uid; unread = chats.reduce((n, c) => n + (c.unread?.[me] || 0), 0); setBadge();
    for (const c of chats) {
      const n = c.unread?.[me] || 0;
      if (n > (seen[c.id] || 0) && seen[c.id] !== undefined && localStorage.getItem('hisaab.notify') === '1' && globalThis.Notification?.permission === 'granted' && location.hash !== `#/chat/${c.members.find(m => m !== me)}`)
        new Notification(c.names?.[c.members.find(m => m !== me)] || 'New message', { body: c.lastMessage?.text || '' });
      seen[c.id] = n;
    }
  });
  draw();
}

addEventListener('error', e => logger.error('Unhandled error', { message: e.message, at: `${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', e => logger.error('Unhandled promise rejection', { reason: String(e.reason) }));
$('#nav').addEventListener('click', e => e.target.closest('[data-add]') && openTxnSheet());
addEventListener('hashchange', draw);
store.subscribe(() => { if (current().name !== 'chat') draw(); }); // don't wipe a half-typed message

initLock();
await store.init();
await store.runRecurring();
draw();
logger.info('App started', { mode: prefs().mode, theme: prefs().theme });
pruneLogs();
if (cloud.configured()) { cloud.onChange(cloudChanged); cloud.init().then(cloudChanged).catch(e => logger.warn('Cloud init failed', { error: String(e) })); }
