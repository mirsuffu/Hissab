import { store } from '../core/store.js';
import { fmt, toMinor, fromMinor } from '../core/models.js';
import { SUSPENSE_FUND_ID, GENERAL_ID } from '../config.js';
import { esc, dot, openSheet, closeSheet, toast, confirmModal } from '../ui.js';
import { suspenseBalance } from '../core/calc.js';

export function render(root) {
  const L = store.live();
  const txns = L.txns.filter(t => t.fundId === SUSPENSE_FUND_ID || t.isSuspense);
  const bal = suspenseBalance(L.txns, SUSPENSE_FUND_ID);
  const isClear = bal === 0;

  root.innerHTML = `
    <header class="top">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="icon-btn" onclick="history.back()" aria-label="Go Back">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <h1>Suspense Account</h1>
          <p class="muted" style="font-size:.82rem">उचंत खाता · Unverified differences &amp; ghost cash holding ledger</p>
        </div>
      </div>
      ${!isClear ? `<button class="btn danger" id="btn-writeoff" style="font-size:.82rem;padding:6px 12px">Write Off Variance</button>` : ''}
    </header>

    <div class="card glass" style="margin-bottom:20px;border-left:4px solid ${isClear ? 'var(--income)' : 'var(--accent)'};padding:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <span class="label" style="text-transform:uppercase;font-weight:700;letter-spacing:.05em">Suspense Holding Balance</span>
          <div style="font-size:2rem;font-weight:800;color:${isClear ? 'var(--income)' : 'var(--ink)'};margin-top:4px">
            ${fmt(Math.abs(bal))} ${bal < 0 ? '<span style="font-size:1rem;color:var(--expense)">(Credit Shortage)</span>' : bal > 0 ? '<span style="font-size:1rem;color:var(--accent)">(Debit Excess)</span>' : ''}
          </div>
        </div>
        <div style="max-width:320px;font-size:.82rem;color:var(--ink-2)">
          ${isClear
            ? '✨ <b>All clear!</b> No ghost amounts or unaccounted variances are pending. Books match reality.'
            : '⚠️ <b>Holding active:</b> This amount was parked to keep your physical cash and bank books balanced. Reclassify when you discover the real spend, or write it off.'}
        </div>
      </div>
    </div>

    <section class="stack">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>Unresolved Entries (${txns.length})</h2>
      </div>

      ${txns.length ? `
        <div class="rows">
          ${txns.map(t => {
            const fund = L.funds.find(f => f.id === t.fundId) || L.allFunds.find(f => f.id === t.fundId);
            return `
              <div class="row-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;gap:12px">
                <div style="flex:1">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-weight:600">${esc(t.note || 'Unidentified Variance')}</span>
                    ${t.isSuspense ? '<span class="badge" style="font-size:.7rem;padding:2px 6px">Ghost Variance</span>' : ''}
                  </div>
                  <div class="muted" style="font-size:.78rem;margin-top:2px">
                    <span>${t.date}</span> · <span>Originated from: ${fund ? esc(fund.name) : 'Physical Cash'}</span>
                  </div>
                </div>
                <div style="text-align:right;display:flex;align-items:center;gap:12px">
                  <b style="font-size:1.05rem;color:${t.type === 'in' ? 'var(--income)' : 'var(--expense)'}">
                    ${t.type === 'in' ? '+' : '−'}${fmt(t.amount)}
                  </b>
                  <button class="btn primary" data-reclass-id="${t.id}" style="padding:4px 10px;font-size:.78rem">Reclassify</button>
                  <button class="icon-btn danger" data-del-id="${t.id}" title="Delete" style="width:28px;height:28px">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="empty glass">
          <p>No suspense items found. When you reconcile a bank account or cash pocket and park an unexplained difference, it will appear here.</p>
        </div>
      `}
    </section>
  `;

  // Attach event handlers
  root.onclick = async e => {
    const t = e.target;
    if (t.closest('[data-reclass-id]')) {
      const id = t.closest('[data-reclass-id]').dataset.reclassId;
      const txn = txns.find(x => x.id === id);
      if (txn) openReclassifyModal(txn, root);
    } else if (t.closest('[data-del-id]')) {
      const id = t.closest('[data-del-id]').dataset.delId;
      const txn = txns.find(x => x.id === id);
      if (txn) {
        const ok = await confirmModal({
          title: 'Delete Suspense Entry?',
          message: `Permanently delete this variance of ${fmt(txn.amount)}? Note: This may cause your ledger to differ from your physical cash again.`,
          confirmText: 'Delete',
          danger: true
        });
        if (ok) {
          await store.removeTxn(txn);
          toast('Suspense entry discarded 🗑️');
          render(root);
        }
      }
    } else if (t.closest('#btn-writeoff')) {
      const ok = await confirmModal({
        title: 'Write Off Suspense Balance?',
        message: `Write off the net balance of ${fmt(Math.abs(bal))} as "Cash Shortage / Sundry Loss" expense? This will permanently close the variance and balance the Suspense Account to ₹0.`,
        confirmText: 'Write Off Now'
      });
      if (ok) {
        // Record balancing expense on General category
        let shortageCat = L.categories.find(c => c.name.toLowerCase().includes('shortage') || c.name.toLowerCase().includes('loss'));
        if (!shortageCat) {
          shortageCat = await store.saveItem('categories', { name: 'Cash Shortage / Variance' });
        }
        for (const item of txns) {
          await store.saveTxn({
            ...item,
            isSuspense: false,
            categoryId: shortageCat.id,
            note: `${item.note || 'Variance'} [Written off at audit]`
          });
        }
        toast('Suspense balance written off cleanly! 📜✨');
        render(root);
      }
    }
  };
}

function openReclassifyModal(txn, root) {
  const L = store.live();
  const el = openSheet(`
    <header class="sheet-head">
      <h2>Reclassify Suspense Entry</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <form id="reclass-form" style="display:grid;gap:14px;padding:14px">
      <p class="muted" style="font-size:.84rem">
        You are clearing <b>${fmt(txn.amount)}</b> from Suspense. Assign it to the true category where the money was actually spent or received.
      </p>

      <label class="field">
        <span>Category</span>
        <select name="categoryId" required class="dialog-input">
          ${L.categories.map(c => `<option value="${c.id}" ${c.id === txn.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>

      <label class="field">
        <span>Operational Fund (Which bank/pocket actually bore this?)</span>
        <select name="fundId" required class="dialog-input">
          ${L.funds.map(f => `<option value="${f.id}" ${f.id === txn.fundId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
        </select>
      </label>

      <label class="field">
        <span>Note / Description</span>
        <input name="note" class="dialog-input" value="${esc(txn.note || '')}" placeholder="e.g. Paid carpenter for drawer repair" required>
      </label>

      <div style="display:flex;gap:10px;margin-top:10px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">Reclassify &amp; Clear</button>
      </div>
    </form>
  `);

  el.querySelector('#reclass-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const catId = fd.get('categoryId');
    const fundId = fd.get('fundId');
    const note = fd.get('note').trim();

    await store.saveTxn({
      ...txn,
      fundId,
      categoryId: catId,
      note,
      isSuspense: false // Cleared from suspense!
    });

    closeSheet();
    toast('Entry reclassified! Suspense cleared ✨');
    render(root);
  };
}
