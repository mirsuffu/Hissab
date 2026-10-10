import { store } from '../core/store.js';
import { fundBalance, summary, meter, monthRange } from '../core/calc.js';
import { fmt } from '../core/models.js';
import { esc, dot } from '../ui.js';
import { alerts, forecast, byCategory, notify } from '../core/insights.js';

export const tile = (f, txns) => {
  const [a, b] = monthRange(), m = meter(f, txns, a, b);
  const pct = m ? Math.min(100, Math.round((m.spent / (m.total || 1)) * 100)) : 0;
  return `<a class="tile raised" href="#/funds/${f.id}">
    <span>${dot(f.hue)}${esc(f.name)}</span>
    <b>${fmt(fundBalance(f, txns))}</b>
    ${f.holder ? `<span class="label">For ${esc(f.holder)}</span>` : ''}
    ${m ? `<div class="meter d-only inset ${m.spent > m.total ? 'over' : ''}"><i style="width:${pct}%"></i></div><span class="label d-only">${fmt(m.spent)} ${m.caption}</span>` : ''}
  </a>`;
};

export function render(root) {
  const { funds, allFunds, txns } = store.live();
  const [a, b] = monthRange(), s = summary(allFunds, txns, a, b); // includes entries of since-deleted funds
  const sum = list => list.reduce((x, f) => x + fundBalance(f, txns), 0);
  const held = funds.filter(f => f.type === 'held'), mine = funds.filter(f => f.type !== 'held');
  const L = store.live(), al = alerts(L), fc = forecast(L), cats = byCategory(L), top = cats[0]?.amount || 1;
  notify(al);
  const month = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  root.innerHTML = `
    <header class="top">
      <div><h1>Overview</h1><p class="muted">${month}</p></div>
      <a href="#/metrics" class="btn" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;font-size:.82rem;font-weight:650">
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
        <span>Metrics</span>
      </a>
    </header>
    <section class="hero raised">
      <div><span class="label">Your money</span><strong class="big">${fmt(sum(mine))}</strong></div>
      <div class="split d-only"><div><span class="label">In this month</span><b class="pos">${fmt(s.income)}</b></div><div><span class="label">Out this month</span><b>${fmt(s.expense)}</b></div></div>
      <div class="verdict inset ${s.net >= 0 ? 'pos' : 'neg'}">${s.net >= 0 ? 'Saved' : 'Overspent'} ${fmt(Math.abs(s.net))} so far</div>
    </section>
    ${al.length ? `<section class="card glass stack"><h2>Heads-up</h2>${al.map(a => `<p class="${a.level === 'bad' ? 'neg' : ''}">${esc(a.text)}</p>`).join('')}</section>` : ''}
    ${fc.spent ? `<section class="card glass d-only"><span class="label">Spending forecast</span><b>On pace for ${fmt(fc.projected)} this month</b>${fc.avg ? `<p class="muted">Usual month: ${fmt(fc.avg)}</p>` : ''}</section>` : ''}
    ${cats.length ? `<section class="card glass stack d-only"><h2>Where it went</h2>${cats.map(c => `<div><div class="split" style="justify-content:space-between"><span>${esc(c.name)}</span><b>${fmt(c.amount)}</b></div><div class="meter inset"><i style="width:${Math.round(c.amount / top * 100)}%"></i></div></div>`).join('')}</section>` : ''}
    ${held.length ? `<section class="card glass"><span class="label">Held for others</span><strong class="big" style="font-size:1.6rem">${fmt(sum(held))}</strong><p class="muted">Kept apart — not counted in your money.</p></section>` : ''}
    <section class="stack"><h2>Funds</h2>
      ${funds.length ? `<div class="grid">${funds.map(f => tile(f, txns)).join('')}</div>`
        : `<div class="empty glass"><p>No funds yet. A fund is a pot of money with a purpose.</p><p><a class="btn" href="#/funds">Create your first fund</a></p></div>`}
    </section>`;
}
