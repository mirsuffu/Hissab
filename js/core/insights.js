// Forecast, category breakdown, alerts, unusual-spend detection. Pure functions over store.live().
import { dateTs, fmt } from './models.js';
import { monthRange, fundBalance } from './calc.js';

const own = L => new Set(L.allFunds.filter(f => f.type !== 'held').map(f => f.id));
const sum = a => a.reduce((x, t) => x + t.amount, 0);
const outs = (L, ids, from, to) => L.txns.filter(t => t.type === 'out' && !t.transferId && ids.has(t.fundId) && dateTs(t.date) >= from && dateTs(t.date) < to);

export function forecast(L, now = new Date()) {
  const [a, b] = monthRange(now), ids = own(L), day = now.getDate(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const spent = sum(outs(L, ids, a, b)); let tot = 0, n = 0;
  for (let i = 1; i <= 3; i++) { const [x, y] = monthRange(new Date(now.getFullYear(), now.getMonth() - i, 1)), s = sum(outs(L, ids, x, y)); if (s > 0) { tot += s; n++; } }
  return { spent, projected: Math.round(spent / day * dim), avg: n ? Math.round(tot / n) : 0 };
}

export function byCategory(L, now = new Date()) {
  const [a, b] = monthRange(now), names = Object.fromEntries(L.allCategories.map(c => [c.id, c.name])), m = new Map();
  for (const t of outs(L, own(L), a, b)) { const k = names[t.categoryId] || 'General'; m.set(k, (m.get(k) || 0) + t.amount); }
  return [...m].map(([name, amount]) => ({ name, amount })).sort((x, y) => y.amount - x.amount).slice(0, 6);
}

export function alerts(L, now = new Date()) {
  const out = [], [a, b] = monthRange(now), mk = `${now.getFullYear()}-${now.getMonth()}`, DAY = 864e5, t0 = now.getTime();
  for (const f of L.funds) {
    const mine = L.txns.filter(t => t.fundId === f.id && t.type === 'out' && !t.transferId), bal = fundBalance(f, L.txns);
    if (f.type !== 'held' && f.budget) {
      const s = sum(mine.filter(t => dateTs(t.date) >= a && dateTs(t.date) < b)), p = s / f.budget;
      if (p >= 1) out.push({ key: `b:${f.id}:over:${mk}`, level: 'bad', text: `${f.name} is over its monthly budget by ${fmt(s - f.budget)}` });
      else if (p >= .8) out.push({ key: `b:${f.id}:80:${mk}`, level: 'warn', text: `${f.name} has used ${Math.round(p * 100)}% of its monthly budget` });
    }
    if (bal < 0) out.push({ key: `neg:${f.id}`, level: 'bad', text: `${f.name} is below zero (${fmt(bal)})` });
    else {
      const recent = sum(mine.filter(t => { const s = dateTs(t.date); return s > t0 - 30 * DAY && s <= t0; })) / 30;
      if (recent > 0 && bal / recent <= 7) out.push({ key: `run:${f.id}:${mk}`, level: 'warn', text: `${f.name} may run out in about ${Math.max(1, Math.round(bal / recent))} days at the current pace` });
    }
  }
  // Unusual spends: last 7 days, compared with older spends in the same category (needs 5+ samples).
  const spends = L.txns.filter(t => t.type === 'out' && !t.transferId), names = Object.fromEntries(L.allCategories.map(c => [c.id, c.name]));
  for (const t of spends.filter(x => dateTs(x.date) > t0 - 7 * DAY)) {
    const prior = spends.filter(x => x.categoryId === t.categoryId && x.id !== t.id && dateTs(x.date) < dateTs(t.date));
    if (prior.length < 5) continue;
    const mean = sum(prior) / prior.length, sd = Math.sqrt(prior.reduce((s, x) => s + (x.amount - mean) ** 2, 0) / prior.length);
    if (t.amount > mean + 2 * sd && t.amount >= 1.5 * mean) out.push({ key: `odd:${t.id}`, level: 'warn', text: `Unusual ${names[t.categoryId] || 'General'} spend: ${fmt(t.amount)} (usually about ${fmt(Math.round(mean))})` });
  }
  return out;
}

export function notify(list) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted' || localStorage.getItem('hisaab.notify') !== '1') return;
  const day = new Date().toLocaleDateString('en-CA'), seen = JSON.parse(localStorage.getItem('hisaab.notified') || '{}');
  for (const a of list) { if (seen[a.key] === day) continue; new Notification('Hisaab', { body: a.text }); seen[a.key] = day; }
  localStorage.setItem('hisaab.notified', JSON.stringify(seen));
}
