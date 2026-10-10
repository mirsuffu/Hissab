// App state + actions. Every write: update memory -> persist -> append to audit trail -> queue for sync -> re-render.
// Deleting is PROSPECTIVE: records are flagged `deleted`, never removed. Old entries keep pointing at them,
// so history looks exactly as it did; the item just disappears from pickers and new entries.
import * as db from './db.js';
import { sync } from './sync.js';
import { logger } from './log.js';
import { uid, newFund, fmt, today } from './models.js';
import { advance } from './recurring.js';
import { DEFAULT_CATEGORIES, GENERAL_ID } from '../config.js';

const S = { profiles: [], funds: [], categories: [], parties: [], transactions: [], recurring: [], audit: [], profileId: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());

const SKIP = new Set(['id', 'updatedAt', 'createdAt']);
const labelOf = (kind, d) => kind === 'recurring' ? `${d.note || 'Recurring'} ${fmt(d.amount)} ${d.every}` : kind === 'transactions' ? `${d.type === 'in' ? 'Received' : 'Spent'} ${fmt(d.amount)}${d.note ? ' · ' + d.note : ''}` : (d.name || d.id);
function diff(before, after) {
  const out = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
    if (SKIP.has(k)) continue;
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after[k])) out[k] = [before?.[k] ?? null, after[k] ?? null];
  }
  return out;
}
async function record(kind, before, doc) {
  const changes = diff(before, doc);
  if (before && !Object.keys(changes).length) return;
  const action = !before ? 'create' : doc.deleted && !before.deleted ? 'delete' : !doc.deleted && before.deleted ? 'restore' : 'update';
  const who = S.profiles.find(p => p.id === S.profileId);
  const rec = { id: uid(), ts: Date.now(), actor: who ? { id: who.id, name: who.name } : null, entity: kind, entityId: doc.id, action, label: labelOf(kind, doc), changes, updatedAt: Date.now() };
  await db.put('audit', rec); S.audit.push(rec); sync.push('audit', rec);
}
async function put(kind, doc, notify = true, audit = true) {
  const i = S[kind].findIndex(x => x.id === doc.id);
  const before = i < 0 ? null : structuredClone(S[kind][i]);
  doc.updatedAt = Date.now();
  await db.put(kind, doc);
  i < 0 ? S[kind].push(doc) : (S[kind][i] = doc);
  if (audit && kind !== 'audit') await record(kind, before, doc);
  sync.push(kind, doc);
  if (notify) emit();
  return doc;
}

export const store = {
  subscribe: f => (subs.add(f), () => subs.delete(f)),

  async init() {
    for (const k of db.KINDS) S[k] = await db.all(k);
    if (!S.profiles.length) await put('profiles', { id: uid(), name: 'Me' }, false, false);
    if (!S.categories.some(c => c.id === GENERAL_ID)) await put('categories', { id: GENERAL_ID, name: 'General', deleted: false }, false, false);
    if (!localStorage.getItem('hisaab.seeded')) {
      if (!S.categories.some(c => c.id !== GENERAL_ID)) for (const name of DEFAULT_CATEGORIES.slice(1)) await put('categories', { id: uid(), name, deleted: false }, false, false);
      localStorage.setItem('hisaab.seeded', '1');
    }
    // One-time migration: older entries stored a category name; now they point at a category id.
    for (const t of S.transactions.filter(x => !x.categoryId)) {
      const nm = (t.category || '').trim();
      let c = nm && S.categories.find(x => x.name.toLowerCase() === nm.toLowerCase());
      if (nm && !c) c = await put('categories', { id: uid(), name: nm, deleted: false }, false, false);
      const nt = { ...t, categoryId: c?.id || GENERAL_ID, partyId: t.partyId || '' };
      delete nt.category;
      await put('transactions', nt, false, false);
    }
    const saved = localStorage.getItem('hisaab.profile');
    S.profileId = S.profiles.some(p => p.id === saved) ? saved : S.profiles[0].id;
  },

  live() {
    const allFunds = S.funds.filter(f => f.profileId === S.profileId), ids = new Set(allFunds.map(f => f.id));
    return {
      profile: S.profiles.find(p => p.id === S.profileId), profiles: S.profiles,
      funds: allFunds.filter(f => !f.deleted), allFunds,            // active vs everything (history needs everything)
      txns: S.transactions.filter(t => !t.deleted && ids.has(t.fundId)),
      categories: S.categories.filter(c => !c.deleted), allCategories: S.categories,
      parties: S.parties.filter(p => !p.deleted), allParties: S.parties,
      recurring: S.recurring.filter(r => !r.deleted && ids.has(r.fundId)),
    };
  },
  auditTrail: () => [...S.audit].sort((a, b) => b.ts - a.ts),
  nameMap: () => Object.fromEntries([...S.funds, ...S.categories, ...S.parties, ...S.profiles].map(x => [x.id, x.name])),

  saveFund: d => put('funds', d.id ? d : newFund({ ...d, profileId: S.profileId })),
  removeFund: f => put('funds', { ...f, deleted: true }),
  restoreFund: f => put('funds', { ...f, deleted: false }),

  // Categories & parties share one shape: { id, name, deleted }.
  saveItem: (kind, d) => put(kind, d.id ? d : { ...d, id: uid(), deleted: false, createdAt: Date.now() }),
  removeItem: (kind, d) => put(kind, { ...d, deleted: true }),
  restoreItem: (kind, d) => put(kind, { ...d, deleted: false }),

  saveTxn: d => put('transactions', { ...(d.id ? d : { ...d, id: uid(), createdAt: Date.now(), deleted: false }), categoryId: d.categoryId || GENERAL_ID, partyId: d.partyId || '' }),
  removeTxn: t => put('transactions', { ...t, deleted: true }),

  saveRecurring: d => put('recurring', d.id ? d : { ...d, id: uid(), deleted: false, active: true, createdAt: Date.now() }),
  removeRecurring: r => put('recurring', { ...r, deleted: true }),
  // Creates every due entry (catches up if the app wasn't opened) and moves `next` forward.
  async runRecurring() {
    const t = today(); let n = 0;
    for (const r of S.recurring.filter(x => !x.deleted && x.active && x.next <= t)) {
      const fund = S.funds.find(f => f.id === r.fundId); if (!fund || fund.deleted) continue;
      let next = r.next, guard = 0;
      while (next <= t && guard++ < 400) {
        await put('transactions', { id: uid(), fundId: r.fundId, type: r.type, amount: r.amount, categoryId: r.categoryId || GENERAL_ID, partyId: r.partyId || '', note: r.note || '', date: next, recurringId: r.id, deleted: false, createdAt: Date.now() }, false);
        next = advance(next, r); n++;
      }
      await put('recurring', { ...r, next }, false);
    }
    if (n) { logger.info('Recurring entries added', { count: n }); emit(); }
    return n;
  },
  touch: emit,
  allDocs: () => Object.fromEntries(db.KINDS.map(k => [k, S[k]])),

  async addProfile(name) { const p = await put('profiles', { id: uid(), name }); logger.info('Person added', { name }); store.switchProfile(p.id); },
  switchProfile(id) { S.profileId = id; localStorage.setItem('hisaab.profile', id); logger.info('Switched person'); emit(); },
  async deleteProfile(id) {
    if (!id || id === S.profiles[0]?.id) throw new Error('Primary profile cannot be deleted');
    const p = S.profiles.find(x => x.id === id);
    if (!p) return;
    const before = structuredClone(p);
    await db.del('profiles', id);
    S.profiles = S.profiles.filter(x => x.id !== id);
    await record('profiles', before, { ...p, deleted: true });
    sync.push('profiles', { ...p, deleted: true });
    if (S.profileId === id) store.switchProfile(S.profiles[0].id);
    else { logger.info('Profile deleted', { name: p.name }); emit(); }
  },

  exportAll() { logger.info('Backup exported'); return JSON.stringify({ app: 'hisaab', v: 2, data: Object.fromEntries(db.KINDS.map(k => [k, S[k]])) }, null, 2); },
  async importAll(text) {
    const { data } = JSON.parse(text);
    for (const k of db.KINDS) for (const doc of data[k] || []) await store.applyRemote(k, doc, false);
    logger.info('Backup imported'); emit();
  },
  async applyRemote(kind, doc, notify = true) {
    const cur = S[kind].find(x => x.id === doc.id);
    if (kind === 'audit' ? cur : cur && cur.updatedAt >= doc.updatedAt) return; // audit records are immutable
    await db.put(kind, doc);
    cur ? Object.assign(cur, doc) : S[kind].push(doc);
    if (notify) emit();
  },
};
