// Cloud sync layer. Local DB stays the source of truth; changes queue in an outbox and flush when online.
// Conflict rule: last write wins by `updatedAt`. Plug a backend via sync.connect(adapter) — see firebase-adapter.js.
import { KINDS } from './db.js';
import { logger } from './log.js';
const OUT = 'hisaab.outbox', PULLED = 'hisaab.pulled';
let adapter = null;
const read = () => JSON.parse(localStorage.getItem(OUT) || '[]');
const write = v => localStorage.setItem(OUT, JSON.stringify(v));
const same = (a, b) => a.kind === b.kind && a.doc.id === b.doc.id;

const syncListeners = new Set();
export const onSyncActivity = fn => syncListeners.add(fn);
function notifySync() {
  syncListeners.forEach(fn => { try { fn(); } catch {} });
}

let syncTimer = null;

export const syncState = () => {
  if (!adapter) return { code: 'local', label: 'Local only', icon: '💻', pending: 0 };
  if (!navigator.onLine) return { code: 'offline', label: 'Offline', icon: '⚠️', pending: read().length };
  const p = read().length;
  if (p > 0) return { code: 'pending', label: `${p} pending`, icon: '⏳', pending: p };
  return { code: 'synced', label: 'Synced', icon: '✓', pending: 0 };
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { notifySync(); sync.flush(); });
  window.addEventListener('offline', () => { notifySync(); });
}

export const sync = {
  status: () => (!adapter ? 'Local only' : navigator.onLine ? `Synced (${read().length} pending)` : 'Offline'),
  state: syncState,
  interval: () => Number(localStorage.getItem('hisaab.syncInterval') ?? 0),
  setInterval: sec => { localStorage.setItem('hisaab.syncInterval', sec); },
  onSyncActivity: fn => syncListeners.add(fn),
  async connect(a) { adapter = a; logger.info('Cloud sync connected'); await sync.flush(); },
  disconnect() { adapter = null; clearTimeout(syncTimer); notifySync(); logger.info('Cloud sync disconnected'); },
  push(kind, doc) {
    if (!adapter) return;
    write([...read().filter(x => !same(x, { kind, doc })), { kind, doc }]);
    if (sync.interval() === 0) sync.flush();
  },
  // First-time upload after enabling cloud sync: sends every local record straight to the adapter.
  async pushAll(all) {
    if (!adapter) return;
    notifySync();
    for (const [kind, docs] of Object.entries(all)) for (const doc of docs) { try { await adapter.push(kind, doc); } catch (e) { logger.warn('Initial upload failed', { kind, error: String(e) }); return; } }
    logger.info('Initial upload finished');
  },
  async flush() {
    if (!adapter || !navigator.onLine) return;
    notifySync();
    for (const item of read()) {
      try { await adapter.push(item.kind, item.doc); write(read().filter(x => !(same(x, item) && x.doc.updatedAt === item.doc.updatedAt))); }
      catch (e) { logger.warn('Sync push failed', { kind: item.kind, error: String(e) }); break; }
    }
  },
  async pull(apply) {
    if (!adapter || !navigator.onLine) return;
    notifySync();
    const since = Number(localStorage.getItem(PULLED) || 0), now = Date.now();
    for (const kind of KINDS) for (const doc of await adapter.pullSince(kind, since)) await apply(kind, doc);
    localStorage.setItem(PULLED, now);
  },
  schedule(pullFn) {
    clearTimeout(syncTimer);
    const sec = sync.interval();
    if (sec <= 0) return;
    syncTimer = setTimeout(async () => {
      await sync.flush();
      if (pullFn) await sync.pull(pullFn);
      sync.schedule(pullFn);
    }, sec * 1000);
  }
};
if (typeof window !== 'undefined') {
  addEventListener('online', () => sync.flush());
}
