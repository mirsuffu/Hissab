import { dateTs } from './models.js';
import { prefs } from './prefs.js';

export const monthRange = (d = new Date()) =>
  [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
const signed = t => (t.type === 'in' ? t.amount : -t.amount);

export const fundBalance = (f, txns) => f.opening + txns.filter(t => t.fundId === f.id).reduce((a, t) => a + signed(t), 0);

// Gain/Loss = surplus or deficit. Money held for others is NOT income/expense for you.
export function summary(funds, txns, from, to) {
  const own = new Set(funds.filter(f => f.type !== 'held').map(f => f.id));
  let income = 0, expense = 0;
  for (const t of txns) {
    const ts = dateTs(t.date);
    if (!own.has(t.fundId) || ts < from || ts >= to || t.transferId) continue; // transfers between funds are neutral
    t.type === 'in' ? (income += t.amount) : (expense += t.amount);
  }
  return { income, expense, net: income - expense };
}

// Progress meter: held funds -> spent vs received; others -> this month vs monthly budget.
export function meter(f, txns, from, to) {
  const mine = txns.filter(t => t.fundId === f.id);
  if (f.type === 'held') {
    const received = f.opening + mine.filter(t => t.type === 'in').reduce((a, t) => a + t.amount, 0);
    const spent = mine.filter(t => t.type === 'out').reduce((a, t) => a + t.amount, 0);
    return received > 0 || spent > 0 ? { spent, total: received, caption: 'spent of received' } : null;
  }
  if (!f.budget) return null;
  const spent = mine.filter(t => { const s = dateTs(t.date); return t.type === 'out' && s >= from && s < to; }).reduce((a, t) => a + t.amount, 0);
  return { spent, total: f.budget, caption: 'of monthly budget' };
}

// Check for accidental duplicate transactions within the configured window (1 - 24 hours)
export function findDuplicateTxn(L, { type, amount, fundId, id }) {
  if (!amount || !fundId) return null;
  const numAmt = Number(amount);
  const winHours = Number(prefs().dupWindow ?? 6);
  const maxAgeMs = winHours * 3600 * 1000;
  const now = Date.now();

  return L.txns.find(t => {
    if (id && t.id === id) return false;
    if (t.type !== type || t.fundId !== fundId) return false;
    if (Math.abs(t.amount - numAmt) > 0.001) return false;
    const tTime = t.createdAt || t.updatedAt || dateTs(t.date);
    return (now - tTime) >= 0 && (now - tTime) <= maxAgeMs;
  }) || null;
}

