// Offline-first local storage (IndexedDB). Source of truth; cloud sync is layered on top.
// KINDS are synced records. LOCAL stores (logs) stay on this device only.
const NAME = 'hisaab', VERSION = 6;
export const KINDS = ['profiles', 'funds', 'pots', 'categories', 'parties', 'transactions', 'recurring', 'audit'];
export const LOCAL = ['logs', 'receipts'];
let _db;
const open = () => (_db ??= new Promise((res, rej) => {
  const r = indexedDB.open(NAME, VERSION);
  r.onupgradeneeded = () => [...KINDS, ...LOCAL].forEach(k => { if (!r.result.objectStoreNames.contains(k)) r.result.createObjectStore(k, { keyPath: 'id' }); });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const run = async (kind, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(kind, mode), req = fn(t.objectStore(kind));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
};
export const all = kind => run(kind, 'readonly', s => s.getAll());
export const get = (kind, id) => run(kind, 'readonly', s => s.get(id));
export const put = (kind, doc) => run(kind, 'readwrite', s => s.put(doc));
export const del = (kind, id) => run(kind, 'readwrite', s => s.delete(id));
export const clear = kind => run(kind, 'readwrite', s => s.clear());

