import { store } from '../core/store.js';
import { fundBalance, potBalance, potVelocity, suspenseBalance, summary, meter, monthRange } from '../core/calc.js';
import { fmt } from '../core/models.js';
import { esc, dot } from '../ui.js';
import { alerts, forecast, byCategory, notify } from '../core/insights.js';
import { SUSPENSE_FUND_ID } from '../config.js';

export const tile = (f, txns) => {
  const [a, b] = monthRange(), m = meter(f, txns, a, b);
  const bal = fundBalance(f, txns);
  const pct = m ? Math.min(100, Math.round((m.spent / (m.total || 1)) * 100)) : 0;
  const overdraft = bal < 0 ? 'overdraft' : '';
  return `<a class="tile raised ${overdraft}" href="#/funds/${f.id}">
    <span>${dot(f.hue)}${esc(f.name)}</span>
    <b>${fmt(bal)}</b>
    ${f.holder ? `<span class="label">For ${esc(f.holder)}</span>` : ''}
    ${m ? `<div class="meter d-only inset ${m.spent > m.total ? 'over' : ''}"><i style="width:${pct}%"></i></div><span class="label d-only">${fmt(m.spent)} ${m.caption}</span>` : ''}
  </a>`;
};

export const potTile = (p, txns) => {
  const bal = potBalance(p, txns);
  const vel = potVelocity(p, bal);
  return `<a class="tile raised" href="#/pots/${p.id}">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span>${dot(p.hue)}${esc(p.name)}</span>
      ${p.locked ? '<span title="Locked">🔒</span>' : ''}
    </div>
    <b>${fmt(bal)}</b>
    ${p.targetAmount ? `<div class="meter d-only inset"><i style="width:${vel.pct}%;background:hsl(${p.hue} 60% 50%)"></i></div><span class="label d-only">${esc(vel.label)}</span>` : ''}
  </a>`;
};

export function render(root) {
  const { funds, allFunds, pots, txns } = store.live();
  const [a, b] = monthRange(), s = summary(allFunds, txns, a, b); // includes entries of since-deleted funds
  const sum = list => list.reduce((x, f) => x + fundBalance(f, txns), 0);
  const held = funds.filter(f => f.type === 'held'), mine = funds.filter(f => f.type !== 'held');
  const L = store.live(), al = alerts(L), fc = forecast(L), cats = byCategory(L), top = cats[0]?.amount || 1;
  notify(al);
  const month = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Monthly snapshot for the previous completed month (dismissible once per month)
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const snapKey = `hisaab.snap_${lastMonthDate.getFullYear()}_${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const showSnap = !localStorage.getItem(snapKey);
  let snapHtml = '';
  if (showSnap) {
    const [lFrom, lTo] = monthRange(lastMonthDate);
    const ls = summary(allFunds, txns, lFrom, lTo);
    if (ls.income > 0 || ls.expense > 0) {
      const lastMonthName = lastMonthDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      snapHtml = `
        <div class="card glass" id="monthly-snapshot-card" style="border-left:4px solid var(--accent);position:relative;padding:12px 16px;display:grid;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div>
              <span class="label" style="font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em">📊 ${lastMonthName} Summary</span>
              <div style="display:flex;gap:18px;margin-top:6px;flex-wrap:wrap">
                <div><span class="label">Inflow:</span> <b class="pos">+${fmt(ls.income)}</b></div>
                <div><span class="label">Outflow:</span> <b class="neg">−${fmt(ls.expense)}</b></div>
                <div><span class="label">Net:</span> <b class="${ls.net >= 0 ? 'pos' : 'neg'}">${ls.net >= 0 ? '+' : '−'}${fmt(Math.abs(ls.net))}</b></div>
              </div>
            </div>
            <button type="button" class="btn" id="dismiss-snap-btn" title="Dismiss" style="padding:4px 8px;font-size:.76rem;cursor:pointer">✕ Dismiss</button>
          </div>
        </div>
      `;
    }
  }

  const suspBal = suspenseBalance(txns, SUSPENSE_FUND_ID);
  const suspHtml = suspBal !== 0 ? `
    <div class="card glass" style="border-left:4px solid var(--accent);padding:12px 16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <span style="font-weight:700;font-size:.88rem;color:var(--accent)">⚖️ Suspense Account: ${fmt(Math.abs(suspBal))} pending</span>
          <p class="muted" style="margin:2px 0 0 0;font-size:.78rem">Unreconciled cash/passbook differences held to keep your books balanced.</p>
        </div>
        <a href="#/suspense" class="btn primary" style="padding:4px 10px;font-size:.78rem">Review</a>
      </div>
    </div>
  ` : '';

  root.innerHTML = `
    ${snapHtml}
    ${suspHtml}
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
      ${funds.length ? `<div class="grid grid-funds">${funds.map(f => tile(f, txns)).join('')}</div>`
        : `<div class="empty glass"><p>No funds yet. A fund is your operational bank or cash account.</p><p><a class="btn" href="#/funds">Create your first fund</a></p></div>`}
    </section>

    ${pots.length ? `
      <section class="stack" style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2>Savings Pots</h2>
          <a href="#/pots" class="muted" style="font-size:.82rem">View all (${pots.length}) ›</a>
        </div>
        <div class="grid grid-funds">${pots.map(p => potTile(p, txns)).join('')}</div>
      </section>
    ` : ''}`;

  root.querySelector('#dismiss-snap-btn')?.addEventListener('click', () => {
    localStorage.setItem(snapKey, '1');
    root.querySelector('#monthly-snapshot-card')?.remove();
  });
}
