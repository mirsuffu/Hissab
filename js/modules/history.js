import { store } from '../core/store.js';
import { monthRange } from '../core/calc.js';
import { dateTs } from '../core/models.js';
import { esc } from '../ui.js';
import { openTxnSheet, txnRow } from './txn-sheet.js';

let month = new Date(), fundFilter = 'all';

export function render(root) {
  const L = store.live(), { allFunds, txns } = L, [a, b] = monthRange(month), byId = Object.fromEntries(allFunds.map(f => [f.id, f]));
  const rows = txns.filter(t => { const s = dateTs(t.date); return s >= a && s < b && (fundFilter === 'all' || t.fundId === fundFilter); })
    .sort((p, q) => q.date.localeCompare(p.date) || q.createdAt - p.createdAt);
  const days = [...new Set(rows.map(r => r.date))];
  root.innerHTML = `
    <header class="top"><h1>History</h1></header>
    <div class="row">
      <button class="btn" data-m="-1" aria-label="Previous month">‹</button>
      <span class="btn inset" style="cursor:default">${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
      <button class="btn" data-m="1" aria-label="Next month">›</button>
      <label class="field d-only"><select data-fund aria-label="Filter by fund"><option value="all">All funds</option>${allFunds.map(f => `<option value="${f.id}" ${f.id === fundFilter ? 'selected' : ''}>${esc(f.name)}${f.deleted ? ' (deleted)' : ''}</option>`).join('')}</select></label>
    </div>
    ${days.map(d => `<section class="stack"><p class="day">${new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      <div class="rows">${rows.filter(r => r.date === d).map(t => txnRow(t, byId[t.fundId], L)).join('')}</div></section>`).join('')
      || '<div class="empty glass">No entries this month.</div>'}`;
  root.onclick = e => {
    const m = e.target.closest('[data-m]'), ed = e.target.closest('[data-edit]');
    if (m) { month = new Date(month.getFullYear(), month.getMonth() + Number(m.dataset.m), 1); render(root); }
    else if (ed) openTxnSheet({ txn: rows.find(r => r.id === ed.dataset.edit) });
  };
  root.onchange = e => { if (e.target.matches('[data-fund]')) { fundFilter = e.target.value; render(root); } };
}
