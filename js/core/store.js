// App state + actions. Every write: update memory -> persist -> append to audit trail -> queue for sync -> re-render.
// Deleting is PROSPECTIVE: records are flagged `deleted`, never removed. Old entries keep pointing at them,
// so history looks exactly as it did; the item just disappears from pickers and new entries.
import * as db from './db.js';
import { sync } from './sync.js';
import { logger } from './log.js';
import { uid, newFund, newPot, fmt, today } from './models.js';
import { advance } from './recurring.js';
import { DEFAULT_CATEGORIES, GENERAL_ID, SUSPENSE_FUND_ID } from '../config.js';

const S = { profiles: [], funds: [], pots: [], categories: [], parties: [], transactions: [], recurring: [], audit: [], profileId: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());

const SKIP = new Set(['id', 'updatedAt', 'createdAt']);
const labelOf = (kind, d) => kind === 'recurring' ? `${d.note || 'Recurring'} ${fmt(d.amount)} ${d.every}` : kind === 'transactions' ? `${d.type === 'in' ? 'Received' : 'Spent'} ${fmt(d.amount)}${d.note ? ' · ' + d.note : ''}` : kind === 'pots' ? `🏺 Pot: ${d.name}` : (d.name || d.id);
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

export function validateBackup(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { ok: false, error: 'File is not valid JSON! Did an alien beam this file in? 👽📄' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Backup structure is invalid or empty.' };
  }
  const data = parsed.data || parsed;
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'No data payload found in backup file.' };
  }
  let totalRecords = 0;
  const kindsFound = [];
  for (const k of db.KINDS) {
    if (Array.isArray(data[k])) {
      totalRecords += data[k].length;
      kindsFound.push(k);
    }
  }
  if (totalRecords === 0 && !data.profiles && !data.funds) {
    return { ok: false, error: 'Unrecognized backup: no Hisaab funds, profiles, or transactions found.' };
  }
  return { ok: true, data, version: parsed.v || 1, totalRecords, kindsFound };
}

export const store = {
  subscribe: f => (subs.add(f), () => subs.delete(f)),
  validateBackup,

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
    // One-time migration: migrate legacy base64 receipts from transaction docs into 'receipts' store
    for (const t of S.transactions.filter(x => x.receipt)) {
      const rId = uid();
      await db.put('receipts', { id: rId, data: t.receipt, updatedAt: Date.now() });
      const nt = { ...t, receiptId: rId };
      delete nt.receipt;
      await db.put('transactions', nt, false, false);
      Object.assign(t, nt);
    }
    const saved = localStorage.getItem('hisaab.profile');
    S.profileId = S.profiles.some(p => p.id === saved) ? saved : S.profiles[0].id;
    // Auto-initialize Global Suspense Account if not present
    if (!S.funds.some(f => f.id === SUSPENSE_FUND_ID)) {
      await put('funds', {
        id: SUSPENSE_FUND_ID,
        profileId: S.profileId,
        name: 'Suspense Account (उचंत खाता)',
        type: 'own',
        isSuspense: true,
        opening: 0,
        budget: 0,
        hue: 35,
        deleted: false,
        createdAt: Date.now()
      }, false, false);
    }
  },

  live() {
    const allFunds = S.funds.filter(f => f.profileId === S.profileId), ids = new Set(allFunds.map(f => f.id));
    const allPots = (S.pots || []).filter(p => p.profileId === S.profileId);
    const activeFunds = allFunds.filter(f => !f.deleted && f.id !== SUSPENSE_FUND_ID);
    const operationalFunds = allFunds.filter(f => f.id !== SUSPENSE_FUND_ID);
    const suspenseFund = allFunds.find(f => f.id === SUSPENSE_FUND_ID);
    return {
      profile: S.profiles.find(p => p.id === S.profileId), profiles: S.profiles,
      funds: activeFunds, allFunds: operationalFunds,
      suspenseFund,
      pots: allPots.filter(p => !p.deleted && !p.broken),
      allPots: allPots.filter(p => !p.deleted),
      txns: S.transactions.filter(t => !t.deleted && (ids.has(t.fundId) || (t.potId && allPots.some(p => p.id === t.potId)))),
      allTxns: S.transactions.filter(t => ids.has(t.fundId) || (t.potId && allPots.some(p => p.id === t.potId))),
      categories: S.categories.filter(c => !c.deleted), allCategories: S.categories,
      parties: S.parties.filter(p => !p.deleted), allParties: S.parties,
      recurring: S.recurring.filter(r => !r.deleted && ids.has(r.fundId)),
    };
  },
  auditTrail: () => [...S.audit].sort((a, b) => b.ts - a.ts),
  nameMap: () => Object.fromEntries([...S.funds, ...S.pots, ...S.categories, ...S.parties, ...S.profiles].map(x => [x.id, x.name])),

  saveFund: d => put('funds', d.id ? d : newFund({ ...d, profileId: S.profileId })),
  removeFund: f => put('funds', { ...f, deleted: true, archived: false }),
  restoreFund: f => put('funds', { ...f, deleted: false, archived: false }),
  archiveFund: f => put('funds', { ...f, deleted: true, archived: true }),

  savePot: d => put('pots', d.id ? d : newPot({ ...d, profileId: S.profileId })),
  removePot: p => put('pots', { ...p, deleted: true }),
  restorePot: p => put('pots', { ...p, deleted: false, broken: false }),
  breakPot: (p, note = '') => put('pots', { ...p, broken: true, brokenAt: Date.now(), breakNote: note }),

  // Categories & parties share one shape: { id, name, deleted }.
  saveItem: (kind, d) => put(kind, d.id ? d : { ...d, id: uid(), deleted: false, createdAt: Date.now() }),
  removeItem: (kind, d) => put(kind, { ...d, deleted: true }),
  restoreItem: (kind, d) => put(kind, { ...d, deleted: false }),

  async saveTxn(d) {
    if (d.transferId && d.id) {
      const doc = await put('transactions', { ...d, createdAt: d.createdAt || Date.now(), updatedAt: Date.now(), categoryId: d.categoryId || GENERAL_ID, partyId: d.partyId || '' }, false);
      const pair = S.transactions.find(x => x.transferId === d.transferId && x.id !== doc.id && !x.deleted);
      if (pair && (pair.amount !== doc.amount || pair.date !== doc.date)) {
        await put('transactions', { ...pair, amount: doc.amount, date: doc.date, updatedAt: Date.now() }, false);
      }
      emit();
      return doc;
    }
    return put('transactions', {
      ...(d.id
        ? { ...d, createdAt: d.createdAt || Date.now(), updatedAt: Date.now() }
        : { ...d, id: uid(), createdAt: d.createdAt || Date.now(), deleted: false }),
      categoryId: d.categoryId || GENERAL_ID,
      partyId: d.partyId || ''
    });
  },
  async removeTxn(t) {
    await put('transactions', { ...t, deleted: true }, false);
    if (t.transferId) {
      const pair = S.transactions.find(x => x.transferId === t.transferId && x.id !== t.id && !x.deleted);
      if (pair) {
        await put('transactions', { ...pair, deleted: true }, false);
      }
    }
    emit();
  },

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
    // Process Pot Auto-Sweeps
    for (const pot of (S.pots || []).filter(p => !p.deleted && !p.broken && p.autoSweep?.enabled)) {
      const sw = pot.autoSweep;
      if (!sw.amount || !sw.sourceFundId) continue;
      const srcFund = S.funds.find(f => f.id === sw.sourceFundId && !f.deleted);
      if (!srcFund) continue;
      let nextDue = sw.next || t;
      if (nextDue <= t) {
        await put('transactions', {
          id: uid(),
          fundId: sw.sourceFundId,
          potId: pot.id,
          type: 'in',
          amount: sw.amount,
          date: nextDue,
          note: `Auto-Sweep 🏺 (${pot.name})`,
          categoryId: GENERAL_ID,
          deleted: false,
          createdAt: Date.now()
        }, false);
        const d = new Date(nextDue + 'T00:00:00');
        d.setMonth(d.getMonth() + 1);
        sw.next = d.toISOString().slice(0, 10);
        await put('pots', { ...pot, autoSweep: sw }, false);
        n++;
      }
    }
    if (n) { logger.info('Recurring & auto-sweep entries added', { count: n }); emit(); }
    return n;
  },
  touch: emit,
  allDocs: () => Object.fromEntries(db.KINDS.map(k => [k, S[k]])),

  async addProfile(name) { const p = await put('profiles', { id: uid(), name }); logger.info('Person added', { name }); store.switchProfile(p.id); },
  async updateProfile(id, updates) {
    const p = S.profiles.find(x => x.id === id);
    if (!p) return;
    const before = structuredClone(p);
    const updated = { ...p, ...updates, updatedAt: Date.now() };
    await db.put('profiles', updated);
    Object.assign(p, updated);
    await record('profiles', before, updated);
    sync.push('profiles', updated);
    logger.info('Profile updated', { id, name: updated.name });
    emit();
    return updated;
  },
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

  saveReceipt: (id, data) => db.put('receipts', { id, data, updatedAt: Date.now() }),
  getReceipt: async id => (await db.get('receipts', id))?.data || null,
  removeReceipt: id => db.del('receipts', id),

  async saveDraft(d) {
    try {
      const clean = { ...d };
      if (clean.receipt) {
        await db.put('receipts', { id: '__draft__', data: clean.receipt, updatedAt: Date.now() });
        clean.hasReceipt = true;
        delete clean.receipt;
      } else {
        await db.del('receipts', '__draft__');
        clean.hasReceipt = false;
      }
      localStorage.setItem('hisaab.txn_draft', JSON.stringify({ d: clean, ts: Date.now() }));
    } catch {}
  },
  async loadDraft() {
    try {
      const raw = localStorage.getItem('hisaab.txn_draft');
      if (!raw) return null;
      const { d, ts } = JSON.parse(raw);
      if (Date.now() - ts > 3 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem('hisaab.txn_draft');
        await db.del('receipts', '__draft__');
        return null;
      }
      if (d.hasReceipt) {
        d.receipt = (await db.get('receipts', '__draft__'))?.data || null;
      }
      return { d, ts };
    } catch { return null; }
  },
  async clearDraft() {
    try {
      localStorage.removeItem('hisaab.txn_draft');
      await db.del('receipts', '__draft__');
    } catch {}
  },

  async exportAll() {
    logger.info('Backup exported');
    let receipts = [];
    try { receipts = await db.all('receipts'); } catch {}
    const data = Object.fromEntries(db.KINDS.map(k => [k, S[k]]));
    if (receipts && receipts.length) {
      data.receipts = receipts.filter(r => r.id !== '__draft__');
    }
    return JSON.stringify({ app: 'hisaab', v: 2, data }, null, 2);
  },
  async importAll(text) {
    const val = validateBackup(text);
    if (!val.ok) throw new Error(val.error);
    for (const k of db.KINDS) {
      for (const doc of val.data[k] || []) {
        if (doc && doc.id) await store.applyRemote(k, doc, false);
      }
    }
    if (Array.isArray(val.data.receipts)) {
      for (const r of val.data.receipts) {
        if (r && r.id && r.data) await db.put('receipts', r);
      }
    }
    logger.info('Backup imported', { count: val.totalRecords });
    emit();
    return val;
  },
  async applyRemote(kind, doc, notify = true) {
    const cur = S[kind].find(x => x.id === doc.id);
    if (kind === 'audit' ? cur : cur && cur.updatedAt >= doc.updatedAt) return; // audit records are immutable
    await db.put(kind, doc);
    cur ? Object.assign(cur, doc) : S[kind].push(doc);
    if (notify) emit();
  },
};
