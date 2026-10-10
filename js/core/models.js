import { APP } from '../config.js';

export const uid = () => crypto.randomUUID();
export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
export const toMinor = v => Math.round((parseFloat(String(v).replace(/,/g, '')) || 0) * 100); // paise
export const fromMinor = m => String(m / 100);
const nf = new Intl.NumberFormat(APP.locale, { style: 'currency', currency: APP.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmt = m => nf.format(m / 100);
export const dateTs = d => new Date(d + 'T00:00:00').getTime();

// All money is stored as integer minor units (paise) to avoid float drift.
export const newFund = o => ({
  id: uid(), profileId: o.profileId, name: o.name, type: o.type || 'own', holder: o.holder || '',
  opening: o.opening || 0, budget: o.budget || 0,
  hue: o.hue ?? Math.floor(Math.random() * 360), deleted: false, createdAt: Date.now(),
});
export const newTxn = o => ({
  id: uid(), fundId: o.fundId, type: o.type || 'out', amount: o.amount || 0,
  categoryId: o.categoryId || 'cat-general', partyId: o.partyId || '', note: o.note || '', date: o.date || today(), deleted: false, createdAt: Date.now(),
});
