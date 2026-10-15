// Audit trail: append-only record of every change to your money data (who, when, what, before -> after).
import { store } from '../core/store.js';
import { fmt } from '../core/models.js';
import { esc } from '../ui.js';

const ENT = { all: 'Everything', transactions: 'Entries', funds: 'Funds', categories: 'Categories', parties: 'Parties', profiles: 'People' };
const MONEY = new Set(['amount', 'opening', 'budget']), REFS = new Set(['fundId', 'categoryId', 'partyId', 'profileId']);
let filter = 'all';

export function render(root) {
  const names = store.nameMap();
  const val = (k, v) => v === null || v === '' || v === undefined ? '—' : MONEY.has(k) ? fmt(v) : REFS.has(k) ? (names[v] || v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  const all = store.auditTrail().filter(r => filter === 'all' || r.entity === filter), recs = all.slice(0, 300);
  root.innerHTML = `
    <header class="top"><div><a class="muted" href="javascript:history.length>1?history.back():location.hash='#/home'" style="cursor:pointer">‹ Back</a><h1>Audit trail</h1><p class="muted">Every change to your data. Records can’t be edited or removed.</p></div></header>
    <label class="field"><span>Show</span><select data-f>${Object.entries(ENT).map(([k, v]) => `<option value="${k}" ${k === filter ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="rows">${recs.map(r => `
      <details class="audit"><summary>
        <span><span class="chip ${r.action}">${r.action}</span><b>${esc(r.label)}</b></span>
        <small class="muted">${ENT[r.entity] || r.entity} · ${new Date(r.ts).toLocaleString()} · ${esc(r.actor?.name || 'System')}</small></summary>
        <ul>${Object.entries(r.changes).map(([k, [o, n]]) => `<li><span class="muted">${esc(k)}</span> ${r.action === 'create' ? esc(val(k, n)) : `${esc(val(k, o))} → ${esc(val(k, n))}`}</li>`).join('')}</ul>
      </details>`).join('') || '<div class="empty glass">Nothing recorded yet.</div>'}</div>
    ${all.length > recs.length ? `<p class="muted">Showing the latest ${recs.length} of ${all.length}.</p>` : ''}`;
  root.onchange = e => { if (e.target.matches('[data-f]')) { filter = e.target.value; render(root); } };
}
