import { store } from '../core/store.js';
import { fundBalance, meter, monthRange } from '../core/calc.js';
import { fmt, toMinor, fromMinor } from '../core/models.js';
import { FUND_TYPES } from '../config.js';
import { esc, dot, openSheet, closeSheet, toast } from '../ui.js';
import { tile } from './dashboard.js';
import { openTxnSheet, txnRow } from './txn-sheet.js';

export function render(root, id) { id ? detail(root, id) : list(root); }

function list(root) {
  const { funds, allFunds, txns } = store.live(), gone = allFunds.filter(f => f.deleted);
  const groups = Object.entries(FUND_TYPES).map(([k, v]) => ({ ...v, items: funds.filter(f => f.type === k) })).filter(g => g.items.length);
  root.innerHTML = `
    <header class="top"><h1>Funds</h1><button class="btn primary" data-new>New fund</button></header>
    ${groups.map(g => `<section class="stack"><div><h2>${g.label}</h2><p class="muted">${g.hint}</p></div><div class="grid">${g.items.map(f => tile(f, txns)).join('')}</div></section>`).join('')
      || '<div class="empty glass"><p>Create a fund for anything you track separately: wallet, a goal, or money held for someone.</p></div>'}
    ${gone.length ? `<section class="stack"><div><h2>Deleted funds</h2><p class="muted">Past entries are kept. Open one to restore it.</p></div>
      <div class="rows">${gone.map(f => `<a class="row-item" href="#/funds/${f.id}">${dot(f.hue)}${esc(f.name)}<small>Restore</small></a>`).join('')}</div></section>` : ''}`;
  root.onclick = e => e.target.closest('[data-new]') && openFundSheet();
}

function detail(root, id) {
  const L = store.live(), { allFunds, txns } = L, f = allFunds.find(x => x.id === id);
  if (!f) { location.hash = '#/funds'; return; }
  const mine = txns.filter(t => t.fundId === id).sort((p, q) => q.date.localeCompare(p.date) || q.createdAt - p.createdAt);
  const [a, b] = monthRange(), m = meter(f, txns, a, b);
  const received = f.opening + mine.filter(t => t.type === 'in').reduce((x, t) => x + t.amount, 0);
  const spent = mine.filter(t => t.type === 'out').reduce((x, t) => x + t.amount, 0);
  root.innerHTML = `
    <header class="top"><div><a class="muted" href="#/funds">‹ Funds</a><h1>${dot(f.hue)}${esc(f.name)}</h1>${f.holder ? `<p class="muted">Held for ${esc(f.holder)}</p>` : ''}</div>
      <button class="btn" data-edit-fund>Edit</button></header>
    ${f.deleted ? '<div class="card glass"><b>This fund is deleted.</b><p class="muted">Its entries are kept as they were. It can’t take new entries unless restored.</p><p><button class="btn primary" data-restore>Restore fund</button></p></div>' : ''}
    <section class="hero raised"><div><span class="label">Balance</span><strong class="big">${fmt(fundBalance(f, txns))}</strong></div>
      <div class="split d-only"><div><span class="label">Received</span><b class="pos">${fmt(received)}</b></div><div><span class="label">Spent</span><b>${fmt(spent)}</b></div></div>
      ${m ? `<div class="meter d-only inset ${m.spent > m.total ? 'over' : ''}"><i style="width:${Math.min(100, Math.round(m.spent / (m.total || 1) * 100))}%"></i></div><span class="label d-only">${fmt(m.spent)} ${m.caption} (${fmt(m.total)})</span>` : ''}
      <div class="row">${f.deleted ? '' : '<button class="btn primary" data-add>Add entry</button>'}<button class="btn" data-copy>Copy statement</button><a class="btn" href="#/statements/${id}">Export…</a></div>
    </section>
    <section class="stack"><h2>Entries</h2><div class="rows">${mine.map(t => txnRow(t, f, L)).join('') || '<div class="empty glass">Nothing here yet.</div>'}</div></section>`;
  root.onclick = async e => {
    const t = e.target;
    if (t.closest('[data-add]')) openTxnSheet({ fundId: id });
    else if (t.closest('[data-edit-fund]')) openFundSheet(f);
    else if (t.closest('[data-restore]')) { await store.restoreFund(f); toast('Fund restored'); }
    else if (t.closest('[data-copy]')) { await navigator.clipboard?.writeText(statement(f, mine, L, received, spent, fundBalance(f, txns))); toast('Statement copied'); }
    else if (t.closest('[data-edit]')) openTxnSheet({ txn: mine.find(x => x.id === t.closest('[data-edit]').dataset.edit) });
  };
}

const statement = (f, rows, L, received, spent, bal) => [
  `${f.name}${f.holder ? ` — held for ${f.holder}` : ''}`,
  `Received: ${fmt(received)}`, `Spent: ${fmt(spent)}`, `Balance: ${fmt(bal)}`, '',
  ...[...rows].reverse().map(r => {
    const cat = L.allCategories.find(c => c.id === r.categoryId)?.name, party = L.allParties.find(p => p.id === r.partyId)?.name;
    return `${r.date}  ${r.type === 'in' ? '+' : '-'}${fmt(r.amount)}  ${[cat, party, r.note].filter(Boolean).join(' · ')}`;
  }),
].join('\n');

export function openFundSheet(f = null) {
  const d = f || { name: '', type: 'own', holder: '', opening: 0, budget: 0 };
  openSheet(`
    <h2>${f ? 'Edit fund' : 'New fund'}</h2>
    <form id="ff" class="form">
      <label class="field"><span>Name</span><input name="name" required value="${esc(d.name)}"></label>
      <label class="field"><span>Type</span><select name="type">${Object.entries(FUND_TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field" id="holder"><span>Held for (name)</span><input name="holder" value="${esc(d.holder)}"></label>
      <label class="field"><span>Opening balance</span><input name="opening" inputmode="decimal" value="${d.opening ? fromMinor(d.opening) : ''}"></label>
      <label class="field" id="budget"><span>Monthly budget (optional)</span><input name="budget" inputmode="decimal" value="${d.budget ? fromMinor(d.budget) : ''}"></label>
      <div class="row"><button class="btn primary">Save fund</button>${f && !f.deleted ? '<button type="button" class="btn danger" data-del>Delete fund</button>' : ''}</div>
    </form>`, el => {
    const sel = el.querySelector('[name=type]'), sync = () => {
      el.querySelector('#holder').hidden = sel.value !== 'held';
      el.querySelector('#budget').hidden = sel.value === 'held';
    };
    sel.onchange = sync; sync();
    el.querySelector('#ff').onsubmit = async e => {
      e.preventDefault();
      const x = new FormData(e.target);
      await store.saveFund({ ...d, name: x.get('name').trim(), type: x.get('type'), holder: x.get('type') === 'held' ? x.get('holder').trim() : '', opening: toMinor(x.get('opening')), budget: toMinor(x.get('budget')) });
      closeSheet(); toast('Fund saved');
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this fund? Past entries stay exactly as they are. It just can’t be used for new entries.')) return;
      await store.removeFund(f); closeSheet(); location.hash = '#/funds'; toast('Fund deleted');
    });
  });
}
