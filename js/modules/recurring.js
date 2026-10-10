// Recurring entries (rent, subscriptions, allowances). Due ones are created automatically when the app opens.
import { store } from '../core/store.js';
import { fmt, toMinor, fromMinor, today } from '../core/models.js';
import { GENERAL_ID } from '../config.js';
import { esc, openSheet, closeSheet, toast } from '../ui.js';

const EVERY = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
const opt = (x, sel) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`;

export function render(root) {
  const L = store.live(), name = Object.fromEntries(L.allFunds.map(f => [f.id, f.name]));
  root.innerHTML = `
    <header class="top"><div><a class="muted" href="#/settings">‹ Settings</a><h1>Recurring</h1><p class="muted">Entries that repeat on their own.</p></div><button class="btn primary" data-new>Add</button></header>
    <div class="rows">${L.recurring.map(r => `<button class="row-item" data-edit="${r.id}"><span>${esc(r.note || 'Recurring entry')}<small>${EVERY[r.every]} · next ${r.active ? r.next : 'paused'} · ${esc(name[r.fundId] || '')}</small></span><span class="amt ${r.type === 'in' ? 'pos' : ''}">${r.type === 'in' ? '+' : '−'}${fmt(r.amount)}</span></button>`).join('') || '<div class="empty glass">Nothing recurring yet.</div>'}</div>`;
  root.onclick = e => {
    if (e.target.closest('[data-new]')) sheet(null);
    const b = e.target.closest('[data-edit]'); if (b) sheet(L.recurring.find(r => r.id === b.dataset.edit));
  };
}

function sheet(r) {
  const L = store.live();
  if (!L.funds.length) { toast('Create a fund first'); location.hash = '#/funds'; return; }
  const d = r || { type: 'out', amount: 0, fundId: L.funds[0].id, categoryId: GENERAL_ID, partyId: '', note: '', every: 'monthly', next: today(), active: true };
  openSheet(`
    <h2>${r ? 'Edit recurring entry' : 'New recurring entry'}</h2>
    <form id="rf" class="form">
      <div class="seg"><label><input type="radio" name="type" value="out" ${d.type === 'out' ? 'checked' : ''}><span>Spent</span></label><label><input type="radio" name="type" value="in" ${d.type === 'in' ? 'checked' : ''}><span>Received</span></label></div>
      <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" required value="${d.amount ? fromMinor(d.amount) : ''}"></label>
      <label class="field"><span>Fund</span><select name="fundId">${L.funds.map(f => opt(f, d.fundId)).join('')}</select></label>
      <label class="field"><span>Category</span><select name="categoryId">${L.categories.map(c => opt(c, d.categoryId)).join('')}</select></label>
      <label class="field"><span>Party</span><select name="partyId"><option value="">None</option>${L.parties.map(p => opt(p, d.partyId)).join('')}</select></label>
      <label class="field"><span>Repeats</span><select name="every">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${k === d.every ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Next date</span><input type="date" name="next" required value="${d.next}"></label>
      <label class="field"><span>Comment</span><input name="note" autocomplete="off" value="${esc(d.note)}"></label>
      <label class="pill"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span>Active</span></label>
      <div class="row"><button class="btn primary">Save</button>${r ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}</div>
      <p class="muted">Entries already created are never changed or removed.</p>
    </form>`, el => {
    el.querySelector('#rf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target), amount = toMinor(f.get('amount'));
      if (amount <= 0) return toast('Enter an amount above 0');
      const next = f.get('next');
      await store.saveRecurring({ ...d, type: f.get('type'), amount, fundId: f.get('fundId'), categoryId: f.get('categoryId'), partyId: f.get('partyId'), every: f.get('every'), next, day: Number(next.slice(8)), note: f.get('note').trim(), active: f.get('active') === 'on' });
      await store.runRecurring(); closeSheet(); toast('Saved');
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => { if (!confirm('Delete this recurring entry? Past entries stay.')) return; await store.removeRecurring(r); closeSheet(); toast('Deleted'); });
  });
}
