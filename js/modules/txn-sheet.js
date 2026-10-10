import { store } from '../core/store.js';
import { today, toMinor, fromMinor, fmt, uid } from '../core/models.js';
import { GENERAL_ID } from '../config.js';
import { openSheet, closeSheet, toast, esc } from '../ui.js';
import { findDuplicateTxn } from '../core/calc.js';

// Active items + the entry's own item if it was deleted later (so editing old entries never loses data).
const withCurrent = (active, all, id) => { const c = all.find(x => x.id === id); return c && c.deleted ? [...active, c] : active; };
const opt = (x, sel, label) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(label || x.name)}${x.deleted ? ' (deleted)' : ''}</option>`;

export function openTxnSheet({ txn = null, fundId = null } = {}) {
  const L = store.live();
  if (!L.funds.length && !txn) { toast('Create a fund first'); location.hash = '#/funds'; return; }
  const t = txn || { type: 'out', amount: 0, fundId: fundId || L.funds[0].id, categoryId: GENERAL_ID, partyId: '', date: today(), note: '' };
  const funds = withCurrent(L.funds, L.allFunds, t.fundId), cats = withCurrent(L.categories, L.allCategories, t.categoryId), parties = withCurrent(L.parties, L.allParties, t.partyId);
  const otherFund = funds.find(f => f.id !== t.fundId)?.id || funds[0]?.id;
  openSheet(`
    <h2>${txn ? 'Edit entry' : 'New entry'}</h2>
    <form id="tf" class="form">
      <div class="seg">
        <label><input type="radio" name="type" value="out" ${t.type === 'out' ? 'checked' : ''}><span>Spent</span></label>
        <label><input type="radio" name="type" value="in" ${t.type === 'in' ? 'checked' : ''}><span>Received</span></label>
        ${txn || L.funds.length < 2 ? '' : '<label><input type="radio" name="type" value="move"><span>Move</span></label>'}
      </div>
      <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" required autocomplete="off" value="${t.amount ? fromMinor(t.amount) : ''}"></label>
      <label class="field"><span>Fund</span><select name="fundId">${funds.map(f => opt(f, t.fundId, f.name + (f.holder ? ' · ' + f.holder : ''))).join('')}</select></label>
      <label class="field" id="toFund" hidden><span>Move to fund</span><select name="toFund">${funds.map(f => `<option value="${f.id}" ${f.id === otherFund ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="${txn ? 'field cat-party' : 'field d-only cat-party'}"><span>Category</span><select name="categoryId" data-new="categories">${cats.map(c => opt(c, t.categoryId)).join('')}<option value="__new">+ New category…</option></select></label>
      <label class="${txn ? 'field cat-party' : 'field d-only cat-party'}"><span>Party (who from / to)</span><select name="partyId" data-new="parties"><option value="">None</option>${parties.map(p => opt(p, t.partyId)).join('')}<option value="__new">+ New party…</option></select></label>
      <label class="${txn ? 'field' : 'field d-only'}"><span>Date</span><input type="date" name="date" value="${t.date}" required></label>
      <label class="field"><span>Comment</span><input name="note" autocomplete="off" value="${esc(t.note)}"></label>
      <div class="row"><button class="btn primary">Save entry</button>${txn ? '<button type="button" class="btn danger" data-del>Delete entry</button>' : ''}</div>
    </form>`, el => {
    // Inline "+ New …" so you never have to leave the form.
    el.querySelectorAll('select[data-new]').forEach(sel => {
      let prev = sel.value;
      sel.onchange = async () => {
        if (sel.value !== '__new') { prev = sel.value; return; }
        const name = prompt(sel.dataset.new === 'categories' ? 'New category name' : 'New party name')?.trim();
        if (!name) { sel.value = prev; return; }
        const doc = await store.saveItem(sel.dataset.new, { name });
        const o = new Option(name, doc.id, true, true);
        sel.insertBefore(o, sel.querySelector('[value="__new"]')); sel.value = doc.id; prev = doc.id;
      };
    });
    const typeSync = () => {
      const mv = el.querySelector('[name=type]:checked').value === 'move';
      el.querySelector('#toFund').hidden = !mv; el.querySelectorAll('.cat-party').forEach(x => (x.hidden = mv));
    };
    el.querySelectorAll('[name=type]').forEach(r => (r.onchange = typeSync));
    const form = el.querySelector('#tf');
    form.onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target), amount = toMinor(f.get('amount'));
      if (amount <= 0) return toast('Enter an amount above 0');
      if (f.get('type') === 'move') {
        const to = f.get('toFund'), from = f.get('fundId'); if (to === from) return toast('Pick two different funds');
        const nm = Object.fromEntries(L.allFunds.map(x => [x.id, x.name])), tid = uid(), d = f.get('date'), n = f.get('note').trim();
        await store.saveTxn({ fundId: from, type: 'out', amount, date: d, transferId: tid, note: `Transfer to ${nm[to]}${n ? ' · ' + n : ''}` });
        await store.saveTxn({ fundId: to, type: 'in', amount, date: d, transferId: tid, note: `Transfer from ${nm[from]}${n ? ' · ' + n : ''}` });
        closeSheet(); return toast('Transfer saved');
      }

      // Check for duplicate entry within the configured window
      const freshL = store.live();
      const dup = findDuplicateTxn(freshL, { type: f.get('type'), amount, fundId: f.get('fundId'), id: t?.id });
      if (dup && !form._confirmedDup) {
        form._confirmedDup = true;
        const minsAgo = Math.max(1, Math.round((Date.now() - (dup.createdAt || dup.updatedAt || new Date(dup.date).getTime())) / 60000));
        const timeDesc = minsAgo < 60 ? `${minsAgo} min ago` : `${Math.round(minsAgo / 60)}h ago`;
        const fundName = freshL.allFunds.find(x => x.id === f.get('fundId'))?.name || 'this fund';
        let banner = el.querySelector('#dup-warn');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'dup-warn';
          banner.className = 'ai-confirm-done';
          banner.style.cssText = 'color:var(--neg);background:hsl(9 68% 50% / .14);margin:8px 0;font-size:.82rem;font-weight:600';
          form.querySelector('button[type=submit]').before(banner);
        }
        banner.innerHTML = `⚠️ Possible Duplicate: An identical entry of ${fmt(amount)} was logged ${timeDesc} on ${esc(fundName)}. Tap Save again to proceed.`;
        return;
      }

      await store.saveTxn({ ...t, type: f.get('type'), amount, fundId: f.get('fundId'), categoryId: f.get('categoryId'), partyId: f.get('partyId'), date: f.get('date'), note: f.get('note').trim() });
      closeSheet(); toast('Entry saved');
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this entry? It stays in the audit trail.')) return;
      await store.removeTxn(t); closeSheet(); toast('Entry deleted');
    });
  });
}

export function txnRow(t, fund, L) {
  const cat = t.transferId ? 'Transfer' : L.allCategories.find(c => c.id === t.categoryId)?.name || 'General';
  const party = L.allParties.find(p => p.id === t.partyId)?.name;
  return `<button class="row-item" data-edit="${t.id}">
    <span>${esc(cat)}<small>${esc([party, t.note].filter(Boolean).join(' · ') || fund?.name || '')}</small></span>
    <span class="amt ${t.type === 'in' ? 'pos' : ''}">${t.type === 'in' ? '+' : '−'}${fmt(t.amount)}</span>
  </button>`;
}
