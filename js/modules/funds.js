import { store } from '../core/store.js';
import { fundBalance, meter, monthRange } from '../core/calc.js';
import { fmt, toMinor, fromMinor } from '../core/models.js';
import { FUND_TYPES, GENERAL_ID } from '../config.js';
import { prefs } from '../core/prefs.js';
import { esc, dot, openSheet, closeSheet, toast, confirmModal } from '../ui.js';
import { tile } from './dashboard.js';
import { openTxnSheet, openTxnDetail, txnRow, sanitizeAmountInput } from './txn-sheet.js';

export function render(root, id) { id ? detail(root, id) : list(root); }

function list(root) {
  const { funds, allFunds, txns } = store.live();
  const gone = allFunds.filter(f => f.deleted && !f.archived);
  const archived = allFunds.filter(f => f.archived);
  const groups = Object.entries(FUND_TYPES).map(([k, v]) => ({ ...v, items: funds.filter(f => f.type === k) })).filter(g => g.items.length);
  root.innerHTML = `
    <header class="top">
      <div>
        <h1>Funds</h1>
        <p class="muted" style="font-size:.82rem">Operational accounts · <a href="#/pots" style="color:var(--accent);font-weight:600">Switch to Pots 🏺 ›</a></p>
      </div>
      <button class="btn primary" data-new>New fund</button>
    </header>
    ${groups.map(g => `<section class="stack"><div><h2>${g.label}</h2><p class="muted">${g.hint}</p></div><div class="grid grid-funds">${g.items.map(f => tile(f, txns)).join('')}</div></section>`).join('')
      || '<div class="empty glass"><p>Create a fund for anything you track separately: wallet, a goal, or money held for someone.</p></div>'}
    
    ${gone.length ? `
      <details class="settings-acc" style="margin-top:16px">
        <summary>
          <div class="acc-title"><span>🗑️</span><span>Deleted funds (${gone.length})</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body" style="padding:10px 14px">
          <p class="muted" style="font-size:.82rem;margin-bottom:8px">Past entries are kept. Restore to use again, or permanently close.</p>
          <div class="rows">
            ${gone.map(f => `
              <div class="row-item" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px">
                <a href="#/funds/${f.id}" style="display:flex;align-items:center;gap:8px;flex:1">
                  ${dot(f.hue)}<span>${esc(f.name)}</span>
                </a>
                <div style="display:flex;gap:6px">
                  <button class="btn" data-restore-id="${f.id}" style="padding:4px 10px;font-size:.78rem">Restore</button>
                  <button class="btn danger" data-archive-id="${f.id}" style="padding:4px 10px;font-size:.78rem">Delete permanently</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </details>
    ` : ''}

    ${archived.length ? `
      <details class="settings-acc" style="margin-top:12px">
        <summary>
          <div class="acc-title"><span>📁</span><span>Archived / Closed funds (${archived.length})</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body" style="padding:10px 14px">
          <p class="muted" style="font-size:.82rem;margin-bottom:8px">Permanently closed accounts. All historical statements and entries remain intact for audit.</p>
          <div class="rows">
            ${archived.map(f => `
              <a class="row-item" href="#/funds/${f.id}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px">
                <span style="display:flex;align-items:center;gap:8px">${dot(f.hue)}<span>${esc(f.name)}</span></span>
                <small style="color:var(--ink-2)">View history ›</small>
              </a>
            `).join('')}
          </div>
        </div>
      </details>
    ` : ''}`;

  root.onclick = async e => {
    const t = e.target;
    if (t.closest('[data-new]')) openFundSheet();
    else if (t.closest('[data-restore-id]')) {
      const id = t.closest('[data-restore-id]').dataset.restoreId;
      const target = allFunds.find(x => x.id === id);
      if (target) {
        await store.restoreFund(target);
        toast('Fund brought back from the dead! Resurrected & ready 🧟‍♂️✨');
        render(root);
      }
    }
    else if (t.closest('[data-archive-id]')) {
      const id = t.closest('[data-archive-id]').dataset.archiveId;
      const target = allFunds.find(x => x.id === id);
      if (target) {
        const ok = await confirmModal({
          title: 'Permanently Close Fund? 🏛️',
          message: `Permanently retire "${target.name}"? It will be archived and cannot receive new entries, but all past transaction records and statements remain fully accessible.`,
          confirmText: 'Retire Permanently',
          danger: true
        });
        if (ok) {
          await store.archiveFund(target);
          toast('Fund permanently retired into the history books! 🏛️📜');
          render(root);
        }
      }
    }
  };
}

function detail(root, id) {
  const L = store.live(), { allFunds, txns } = L, f = allFunds.find(x => x.id === id);
  if (!f) { location.hash = '#/funds'; return; }
  const mine = txns.filter(t => t.fundId === id).sort((p, q) => q.date.localeCompare(p.date) || (q.createdAt || 0) - (p.createdAt || 0));
  const [a, b] = monthRange(), m = meter(f, txns, a, b);
  const received = f.opening + mine.filter(t => t.type === 'in').reduce((x, t) => x + t.amount, 0);
  const spent = mine.filter(t => t.type === 'out').reduce((x, t) => x + t.amount, 0);
    const bal = fundBalance(f, txns);
    const brsOn = prefs().brsEnabled !== false && !f.deleted && !f.archived && f.type !== 'held';
    root.innerHTML = `
    <header class="top"><div><a class="muted" href="#/funds">‹ Funds</a><h1>${dot(f.hue)}${esc(f.name)}</h1>${f.holder ? `<p class="muted">Held for ${esc(f.holder)}</p>` : ''}</div>
      ${f.archived ? '' : '<button class="btn" data-edit-fund>Edit</button>'}</header>
    ${f.archived
      ? '<div class="card glass"><b>This fund is permanently closed / archived.</b><p class="muted">All entries are preserved as historical record. It cannot accept new entries.</p></div>'
      : (f.deleted ? '<div class="card glass"><b>This fund is deleted.</b><p class="muted">Its entries are kept as they were. It can’t take new entries unless restored.</p><p><button class="btn primary" data-restore>Restore fund</button></p></div>' : '')}
    <section class="hero raised ${bal < 0 ? 'overdraft' : ''}"><div><span class="label">Balance</span><strong class="big ${bal < 0 ? 'neg' : ''}">${fmt(bal)}</strong></div>
      <div class="split d-only"><div><span class="label">Received</span><b class="pos">${fmt(received)}</b></div><div><span class="label">Spent</span><b>${fmt(spent)}</b></div></div>
      ${m ? `<div class="meter d-only inset ${m.spent > m.total ? 'over' : ''}"><i style="width:${Math.min(100, Math.round(m.spent / (m.total || 1) * 100))}%"></i></div><span class="label d-only">${fmt(m.spent)} ${m.caption} (${fmt(m.total)})</span>` : ''}
      <div class="row">${f.deleted ? '' : '<button class="btn primary" data-add>Add entry</button>'}<button class="btn" data-copy>Copy statement</button><a class="btn" href="#/statements/${id}">Export…</a>${brsOn ? '<button class="btn" data-reconcile title="Reconcile against actual bank passbook or physical cash">⚖️ Reconcile</button>' : ''}</div>
    </section>
    <section class="stack"><h2>Entries</h2><div class="rows">${mine.map(t => txnRow(t, f, L)).join('') || '<div class="empty glass">Nothing here yet! Your fund is pristine and untouched 🍃✨</div>'}</div></section>`;
  root.onclick = async e => {
    const t = e.target;
    const editBtn = t.closest('[data-edit-txn]');
    const pill = t.closest('[data-view-txn]');

    if (t.closest('[data-add]')) openTxnSheet({ fundId: id });
    else if (t.closest('[data-edit-fund]')) openFundSheet(f);
    else if (t.closest('[data-reconcile]')) openReconcileModal(f, bal, root);
    else if (t.closest('[data-restore]')) {
      await store.restoreFund(f);
      toast('Fund brought back from the dead! Resurrected & ready 🧟‍♂️✨');
      detail(root, id);
    }
    else if (t.closest('[data-copy]')) {
      await navigator.clipboard?.writeText(statement(f, mine, L, received, spent, bal));
      toast('Statement copied! Go impress your accountant or scare yourself 📋📈');
    }
    else if (editBtn) {
      e.stopPropagation();
      openTxnSheet({ txn: mine.find(x => x.id === editBtn.dataset.editTxn) });
    }
    else if (pill) {
      const targetTxn = mine.find(x => x.id === pill.dataset.viewTxn);
      if (targetTxn) openTxnDetail({ txn: targetTxn, fund: f, L });
    }
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
    <h2>${f ? 'Edit fund 💼' : 'New fund 🍯'}</h2>
    <form id="ff" class="form">
      <label class="field"><span>Name</span><input name="name" required value="${esc(d.name)}" placeholder="e.g. Daily Spending or Travel Pot"></label>
      <label class="field"><span>Type</span><select name="type">${Object.entries(FUND_TYPES).map(([k, v]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field" id="holder"><span>Held for (name)</span><input name="holder" value="${esc(d.holder)}"></label>
      <label class="field"><span>Opening balance</span><input name="opening" inputmode="decimal" placeholder="0.00" value="${d.opening ? fromMinor(d.opening) : ''}"></label>
      <label class="field" id="budget"><span>Monthly budget (optional)</span><input name="budget" inputmode="decimal" placeholder="0.00" value="${d.budget ? fromMinor(d.budget) : ''}"></label>
      <div class="row"><button class="btn primary">Save fund</button>${f && !f.deleted ? '<button type="button" class="btn danger" data-del>Delete fund</button>' : ''}</div>
    </form>`, el => {
    const sel = el.querySelector('[name=type]'), sync = () => {
      el.querySelector('#holder').hidden = sel.value !== 'held';
      el.querySelector('#budget').hidden = sel.value === 'held';
    };
    sel.onchange = sync; sync();

    sanitizeAmountInput(el.querySelector('[name=opening]'));
    sanitizeAmountInput(el.querySelector('[name=budget]'));
    el.querySelector('#ff').onsubmit = async e => {
      e.preventDefault();
      const x = new FormData(e.target);
      await store.saveFund({ ...d, name: x.get('name').trim(), type: x.get('type'), holder: x.get('type') === 'held' ? x.get('holder').trim() : '', opening: toMinor(x.get('opening')), budget: toMinor(x.get('budget')) });
      closeSheet();
      toast(f ? 'Fund details sharpened and saved! 💼✨' : 'New fund unlocked! Time to stash some cash 🍯💰');
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Delete Fund? 🏖️',
        message: 'Send this fund on vacation? Past entries stay completely safe in your records. It just won’t accept new entries.',
        confirmText: 'Delete Fund',
        danger: true
      });
      if (!ok) return;
      await store.removeFund(f);
      closeSheet();
      location.hash = '#/funds';
      toast('Fund sent on an indefinite vacation! 🏖️💼');
    });
  });
}

function openReconcileModal(f, currentBal, root) {
  const el = openSheet(`
    <header class="sheet-head">
      <h2>⚖️ Reconcile ${esc(f.name)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <div style="padding:14px;display:grid;gap:14px">
      <p class="muted" style="font-size:.84rem">
        Audit your Hisaab ledger against your real Bank Passbook / UPI app or physical cash count.
      </p>

      <div class="card glass" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <span class="label" style="font-size:.76rem">Hisaab Ledger Balance</span>
          <div style="font-size:1.3rem;font-weight:700">${fmt(currentBal)}</div>
        </div>
        <div style="text-align:right">
          <span class="label" style="font-size:.76rem">Status</span>
          <div id="brs-status-tag" style="font-size:.85rem;font-weight:600;color:var(--ink-2)">Awaiting count</div>
        </div>
      </div>

      <label class="field">
        <span>Actual Balance in Passbook / Cash Pocket (₹)</span>
        <input id="brs-actual-input" type="text" inputmode="decimal" class="dialog-input" placeholder="0.00" autofocus>
      </label>

      <div id="brs-diff-card" class="card glass" hidden style="padding:12px;display:grid;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="label">Variance</span>
          <b id="brs-diff-val" style="font-size:1.1rem">₹0</b>
        </div>
        <p id="brs-diff-note" class="muted" style="font-size:.8rem"></p>
        <button type="button" id="brs-park-btn" class="btn primary" style="width:100%;margin-top:4px">
          Park Difference in Suspense Account (उचंत खाता)
        </button>
      </div>

      <div style="display:flex;gap:10px;margin-top:6px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
      </div>
    </div>
  `);

  const input = el.querySelector('#brs-actual-input');
  const diffCard = el.querySelector('#brs-diff-card');
  const diffVal = el.querySelector('#brs-diff-val');
  const diffNote = el.querySelector('#brs-diff-note');
  const parkBtn = el.querySelector('#brs-park-btn');
  const statusTag = el.querySelector('#brs-status-tag');

  let currentDiff = 0; // entered - currentBal

  sanitizeAmountInput(input);

  input.oninput = () => {
    const raw = input.value.trim();
    if (!raw) {
      diffCard.hidden = true;
      statusTag.textContent = 'Awaiting count';
      statusTag.style.color = 'var(--ink-2)';
      return;
    }
    const entered = toMinor(raw);
    currentDiff = entered - currentBal;
    diffCard.hidden = false;

    if (currentDiff === 0) {
      diffVal.textContent = '₹0.00 (Perfect Match ✨)';
      diffVal.style.color = 'var(--income)';
      diffNote.textContent = 'Your books and physical balance match 100%. No adjustment needed.';
      parkBtn.hidden = true;
      statusTag.textContent = 'Balanced ✨';
      statusTag.style.color = 'var(--income)';
    } else if (currentDiff < 0) {
      const shortage = Math.abs(currentDiff);
      diffVal.textContent = `−${fmt(shortage)} (Shortage)`;
      diffVal.style.color = 'var(--expense)';
      diffNote.textContent = `Physical balance is ${fmt(shortage)} less than Hisaab ledger. Parking this difference creates a suspense debit to restore balance immediately.`;
      parkBtn.hidden = false;
      parkBtn.textContent = `Park −${fmt(shortage)} in Suspense A/c`;
      statusTag.textContent = 'Shortage ⚠️';
      statusTag.style.color = 'var(--expense)';
    } else {
      diffVal.textContent = `+${fmt(currentDiff)} (Surplus)`;
      diffVal.style.color = 'var(--accent)';
      diffNote.textContent = `Physical balance is ${fmt(currentDiff)} higher than Hisaab ledger. Parking this difference creates a suspense credit to restore balance immediately.`;
      parkBtn.hidden = false;
      parkBtn.textContent = `Park +${fmt(currentDiff)} in Suspense A/c`;
      statusTag.textContent = 'Surplus 📈';
      statusTag.style.color = 'var(--accent)';
    }
  };

  parkBtn.onclick = async () => {
    if (!currentDiff) return;
    const isShortage = currentDiff < 0;
    const absDiff = Math.abs(currentDiff);

    await store.saveTxn({
      fundId: f.id,
      type: isShortage ? 'out' : 'in',
      amount: absDiff,
      categoryId: GENERAL_ID,
      isSuspense: true,
      note: `BRS Variance: ${isShortage ? 'Shortage' : 'Surplus'} vs Passbook`
    });

    closeSheet();
    toast(`Reconciled! ${fmt(absDiff)} parked in Suspense Account ⚖️✨`);
    detail(root, f.id);
  };
}
