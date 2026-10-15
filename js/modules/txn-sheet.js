import { store } from '../core/store.js';
import { today, toMinor, fromMinor, fmt, uid, compressImage } from '../core/models.js';
import { GENERAL_ID } from '../config.js';
import { openSheet, closeSheet, toast, esc, confirmModal, promptModal } from '../ui.js';
import { findDuplicateTxn } from '../core/calc.js';
import { prefs } from '../core/prefs.js';

async function checkAndApplyChillarSaver(doc) {
  const pr = prefs();
  if (!pr.chillarEnabled || !pr.chillarPotId) return null;
  if (doc.type !== 'out' || doc.transferId || doc.isChillar || doc.potId || doc.isSuspense) return null;

  const paise = Number(doc.amount || 0);
  const remainder = paise % 500; // 500 paise = ₹5
  const chillar = remainder > 0 ? 500 - remainder : 0;
  if (chillar <= 0) return null;

  const freshL = store.live();
  const targetPot = freshL.pots.find(p => p.id === pr.chillarPotId);
  if (!targetPot) return null;

  await store.saveTxn({
    fundId: doc.fundId,
    potId: targetPot.id,
    type: 'in',
    amount: chillar,
    date: doc.date || today(),
    isChillar: true,
    note: `Chillar Saver 🏺 (Round-up from ${fmt(paise)})`
  });

  return { chillar, potName: targetPot.name };
}

export function sanitizeAmountInput(inputEl) {
  if (!inputEl) return;
  inputEl.setAttribute('inputmode', 'decimal');
  inputEl.addEventListener('input', () => {
    let val = inputEl.value.replace(/[^0-9.,]/g, '');
    const firstSep = val.search(/[.,]/);
    if (firstSep !== -1) {
      val = val.slice(0, firstSep + 1) + val.slice(firstSep + 1).replace(/[.,]/g, '');
    }
    if (inputEl.value !== val) inputEl.value = val;
  });
}

// Active items + the entry's own item if it was deleted later (so editing old entries never loses data).
const withCurrent = (active, all, id) => { const c = all.find(x => x.id === id); return c && c.deleted ? [...active, c] : active; };
const opt = (x, sel, label) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(label || x.name)}${x.deleted ? ' (deleted)' : ''}</option>`;

export async function openTxnSheet({ txn = null, fundId = null } = {}) {
  const L = store.live();
  if (!L.funds.length && !txn) { toast('Create a fund first'); location.hash = '#/funds'; return; }
  
  // Check for auto-saved draft if starting a fresh entry
  let draft = null;
  if (!txn) {
    draft = await store.loadDraft();
  }
  
  const baseData = draft?.d || {};
  const t = txn || {
    type: baseData.type || 'out',
    amount: baseData.amount ? toMinor(baseData.amount) : 0,
    fundId: baseData.fundId || fundId || L.funds[0].id,
    categoryId: baseData.categoryId || GENERAL_ID,
    partyId: baseData.partyId || '',
    date: baseData.date || today(),
    note: baseData.note || '',
    receiptId: baseData.receiptId || null
  };

  const funds = withCurrent(L.funds, L.allFunds, t.fundId), cats = withCurrent(L.categories, L.allCategories, t.categoryId), parties = withCurrent(L.parties, L.allParties, t.partyId);
  const otherFund = funds.find(f => f.id !== t.fundId)?.id || funds[0]?.id;
  let activeReceipt = t.receipt || (t.receiptId ? await store.getReceipt(t.receiptId) : (baseData.receipt || null));

  openSheet(`
    <h2>${txn ? (t.transferId ? 'Edit transfer' : 'Edit entry') : 'New entry'}</h2>
    <form id="tf" class="form">
      ${draft ? `
        <div id="draft-banner" class="ai-confirm-done" style="display:flex;justify-content:space-between;align-items:center;background:var(--accent-soft);color:var(--accent);font-size:.82rem;padding:6px 10px;border-radius:calc(var(--radius)*.5)">
          <span>📝 Restored unfinished draft</span>
          <button type="button" class="btn" id="discard-draft-btn" style="padding:2px 8px;font-size:.75rem">Discard draft</button>
        </div>
      ` : ''}
      ${t.transferId ? `
        <div class="ai-confirm-done" style="margin-bottom:6px;color:var(--accent);background:var(--accent-soft)">
          ⇄ 2-way Transfer (${t.type === 'in' ? 'Receiving leg' : 'Sending leg'}). Amount and date updates sync both funds automatically.
        </div>
        <input type="hidden" name="type" value="${t.type}">
      ` : `
      <div class="seg">
        <label><input type="radio" name="type" value="out" ${t.type === 'out' ? 'checked' : ''}><span>Spent</span></label>
        <label><input type="radio" name="type" value="in" ${t.type === 'in' ? 'checked' : ''}><span>Received</span></label>
        ${txn || L.funds.length < 2 ? '' : '<label><input type="radio" name="type" value="move"><span>Move</span></label>'}
      </div>`}
      <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" required autocomplete="off" placeholder="0.00" value="${t.amount ? fromMinor(t.amount) : ''}"></label>
      <label class="field"><span>Fund</span><select name="fundId">${funds.map(f => opt(f, t.fundId, f.name + (f.holder ? ' · ' + f.holder : ''))).join('')}</select></label>
      <label class="field" id="toFund" hidden><span>Move to fund</span><select name="toFund">${funds.map(f => `<option value="${f.id}" ${f.id === otherFund ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="${txn ? (t.transferId ? 'field cat-party sr' : 'field cat-party') : 'field d-only cat-party'}"><span>Category</span><select name="categoryId" data-new="categories">${cats.map(c => opt(c, t.categoryId)).join('')}<option value="__new">+ New category…</option></select></label>
      <label class="${txn ? (t.transferId ? 'field cat-party sr' : 'field cat-party') : 'field d-only cat-party'}"><span>Party (who from / to)</span><select name="partyId" data-new="parties"><option value="">None</option>${parties.map(p => opt(p, t.partyId)).join('')}<option value="__new">+ New party…</option></select></label>
      <label class="${txn ? 'field' : 'field d-only'}"><span>Date</span><input type="date" name="date" value="${t.date}" required></label>
      <label class="field"><span>Comment</span><input name="note" autocomplete="off" placeholder="Notes or remarks" value="${esc(t.note)}"></label>

      <!-- Receipt Attachment -->
      <div class="field" id="receipt-section">
        <span style="display:flex;justify-content:space-between;align-items:center">
          <span>Receipt / Payment Screenshot</span>
          <label class="btn" style="padding:4px 10px;font-size:.8rem;cursor:pointer">
            Attach image
            <input type="file" accept="image/*" id="receipt-file-input" hidden>
          </label>
        </span>
        <div id="receipt-preview-wrap" ${activeReceipt ? '' : 'hidden'} style="margin-top:6px;display:flex;align-items:center;gap:10px">
          <img id="receipt-preview-img" src="${activeReceipt || ''}" alt="Receipt" style="max-height:80px;border-radius:calc(var(--radius)*.5);border:1px solid var(--glass-line);cursor:pointer;object-fit:cover">
          <button type="button" class="btn danger" id="receipt-remove-btn" style="padding:4px 8px;font-size:.78rem">✕ Remove</button>
        </div>
      </div>

      <div class="row"><button type="submit" class="btn primary">Save entry</button>${txn ? `<button type="button" class="btn danger" data-del>${t.transferId ? 'Delete transfer' : 'Delete entry'}</button>` : ''}</div>
    </form>`, el => {
    // Amount input filter
    const amtInput = el.querySelector('[name=amount]');
    sanitizeAmountInput(amtInput);

    // Receipt attachment handlers
    const fileInput = el.querySelector('#receipt-file-input');
    const previewWrap = el.querySelector('#receipt-preview-wrap');
    const previewImg = el.querySelector('#receipt-preview-img');
    const removeBtn = el.querySelector('#receipt-remove-btn');

    fileInput?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        toast('Compressing receipt down to featherweight… 🪶📸');
        activeReceipt = await compressImage(file, 800, 0.65);
        previewImg.src = activeReceipt;
        previewWrap.hidden = false;
        const kb = Math.round((activeReceipt.length * 3) / 4096);
        toast(`Evidence attached (${kb} KB)! Sherlock would approve 🧾🕵️‍♂️`);
        saveCurrentDraft();
      } catch (err) {
        toast('Whoops! That image didn’t want to cooperate 🖼️😅');
      }
    });

    removeBtn?.addEventListener('click', () => {
      activeReceipt = null;
      previewImg.src = '';
      previewWrap.hidden = true;
      if (fileInput) fileInput.value = '';
      saveCurrentDraft();
      toast('Receipt shredded! Clean slate 🗑️📄');
    });

    // Auto-save draft on every input change for new entries
    const form = el.querySelector('#tf');
    const saveCurrentDraft = () => {
      if (txn) return;
      const fd = new FormData(form);
      store.saveDraft({
        type: fd.get('type') || 'out',
        amount: fd.get('amount') || '',
        fundId: fd.get('fundId') || '',
        categoryId: fd.get('categoryId') || '',
        partyId: fd.get('partyId') || '',
        date: fd.get('date') || today(),
        note: fd.get('note') || '',
        receipt: activeReceipt
      });
    };
    let draftTimer = null;
    const debouncedSaveDraft = () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveCurrentDraft, 250);
    };
    form.addEventListener('input', debouncedSaveDraft);
    el.querySelector('#discard-draft-btn')?.addEventListener('click', async () => {
      clearTimeout(draftTimer);
      await store.clearDraft();
      closeSheet();
      toast('Draft tossed into the digital dustbin! 🗑️✨');
    });

    // Inline "+ New …" so you never have to leave the form.
    el.querySelectorAll('select[data-new]').forEach(sel => {
      let prev = sel.value;
      sel.onchange = async () => {
        if (sel.value !== '__new') { prev = sel.value; saveCurrentDraft(); return; }
        const isCat = sel.dataset.new === 'categories';
        const name = await promptModal({
          title: isCat ? 'New Category 🏷️' : 'New Party 👤',
          message: isCat ? 'Give this spending bucket a snappy name:' : 'Who is this fine individual or entity?',
          placeholder: isCat ? 'e.g. Chai & Samosa' : 'e.g. Sharma Ji'
        });
        if (!name) { sel.value = prev; return; }
        const doc = await store.saveItem(sel.dataset.new, { name });
        const o = new Option(name, doc.id, true, true);
        sel.insertBefore(o, sel.querySelector('[value="__new"]')); sel.value = doc.id; prev = doc.id;
        saveCurrentDraft();
      };
    });
    const typeSync = () => {
      const mv = el.querySelector('[name=type]:checked')?.value === 'move';
      const toFund = el.querySelector('#toFund');
      if (toFund) toFund.hidden = !mv;
      el.querySelectorAll('.cat-party').forEach(x => (x.hidden = mv || !!t.transferId));
      saveCurrentDraft();
    };
    el.querySelectorAll('[name=type]').forEach(r => (r.onchange = typeSync));

    form.onsubmit = async e => {
      e.preventDefault();
      clearTimeout(draftTimer);
      const submitBtn = form.querySelector('button[type=submit], button:not([type=button]):not([type=reset])');
      if (submitBtn?.disabled) return;
      const origText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
      }
      const resetBtn = () => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origText || 'Save';
        }
      };

      try {
        const f = new FormData(e.target), amount = toMinor(f.get('amount'));
        if (amount <= 0) {
          resetBtn();
          return toast('C’mon, zero paise needs no accounting! Enter a real amount 😉');
        }
        const entryType = f.get('type') || t.type;
        if (entryType === 'move') {
          const to = f.get('toFund'), from = f.get('fundId');
          if (to === from) {
            resetBtn();
            return toast('Moving money to the exact same fund? That’s just stirring the tea! ☕🔄');
          }
          const nm = Object.fromEntries(L.allFunds.map(x => [x.id, x.name])), tid = uid(), d = f.get('date'), n = f.get('note').trim();
          let receiptId = t.receiptId || null;
          if (activeReceipt) {
            if (!receiptId) receiptId = uid();
            await store.saveReceipt(receiptId, activeReceipt);
          } else if (receiptId) {
            await store.removeReceipt(receiptId);
            receiptId = null;
          }
          await store.saveTxn({ fundId: from, type: 'out', amount, date: d, transferId: tid, note: `Transfer to ${nm[to]}${n ? ' · ' + n : ''}`, receiptId });
          await store.saveTxn({ fundId: to, type: 'in', amount, date: d, transferId: tid, note: `Transfer from ${nm[from]}${n ? ' · ' + n : ''}`, receiptId });
          if (!txn) await store.clearDraft();
          closeSheet(); return toast('Teleported funds across accounts like magic! ⚡💸');
        }

        // Check for duplicate entry within the configured window
        const freshL = store.live();
        const dup = findDuplicateTxn(freshL, { type: entryType, amount, fundId: f.get('fundId'), id: t?.id });
        if (dup && !form._confirmedDup) {
          form._confirmedDup = true;
          resetBtn();
          const minsAgo = Math.max(1, Math.round((Date.now() - (dup.createdAt || dup.updatedAt || new Date(dup.date).getTime())) / 60000));
          const timeDesc = minsAgo < 60 ? `${minsAgo} min ago` : `${Math.round(minsAgo / 60)}h ago`;
          const fundName = freshL.allFunds.find(x => x.id === f.get('fundId'))?.name || 'this fund';
          let banner = el.querySelector('#dup-warn');
          if (!banner) {
            banner = document.createElement('div');
            banner.id = 'dup-warn';
            banner.className = 'ai-confirm-done';
            banner.style.cssText = 'color:var(--neg);background:hsl(9 68% 50% / .14);margin:8px 0;font-size:.82rem;font-weight:600';
            (submitBtn || form.lastElementChild).before(banner);
          }
          banner.innerHTML = `⚠️ Whoa! An identical entry of ${fmt(amount)} was logged ${timeDesc} on ${esc(fundName)}. Double trouble or real twin? Tap Save again if intentional! 👯‍♂️`;
          return;
        }

        let receiptId = t.receiptId || null;
        if (activeReceipt) {
          if (!receiptId) receiptId = uid();
          await store.saveReceipt(receiptId, activeReceipt);
        } else if (receiptId) {
          await store.removeReceipt(receiptId);
          receiptId = null;
        }

        const saveDoc = { ...t, type: entryType, amount, fundId: f.get('fundId'), categoryId: f.get('categoryId') || t.categoryId, partyId: f.get('partyId') || t.partyId, date: f.get('date'), note: f.get('note').trim(), receiptId };
        delete saveDoc.receipt;
        await store.saveTxn(saveDoc);
        const chillarRes = await checkAndApplyChillarSaver(saveDoc);
        if (!txn) await store.clearDraft();
        closeSheet();
        let funnyMsg = t.transferId
          ? 'Teleported funds across accounts ⚡💸'
          : (entryType === 'in' ? 'Cha-ching! Inflow logged before anyone asks to borrow it 🤑📈' : 'Boom! Money logged before it vanished into thin air 💸✨');
        if (chillarRes) {
          funnyMsg += ` · +${fmt(chillarRes.chillar)} swept to 🏺 ${chillarRes.potName}`;
        }
        toast(funnyMsg);
      } catch (err) {
        resetBtn();
        toast('Could not save entry: ' + (err.message || 'Unknown error'));
      }
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const confirmMsg = t.transferId
        ? 'Delete this transfer? Both sides of the transaction will vanish from your books.'
        : 'Delete this entry? It will be removed from your active balance and safely noted in the audit trail.';
      const ok = await confirmModal({
        title: t.transferId ? 'Delete Transfer? ⇄' : 'Delete Entry? 🧾',
        message: confirmMsg,
        confirmText: 'Yes, Delete',
        danger: true
      });
      if (!ok) return;
      if (t.receiptId) await store.removeReceipt(t.receiptId);
      await store.removeTxn(t);
      if (!txn) await store.clearDraft();
      closeSheet(); toast(t.transferId ? 'Transfer vanished without a trace! 💨⇄' : 'Poof! Erased like it never happened 💨🧾');
    });
  });
}

export function txnRow(t, fund, L) {
  const cat = t.transferId ? 'Transfer' : L.allCategories.find(c => c.id === t.categoryId)?.name || 'General';
  const party = L.allParties.find(p => p.id === t.partyId)?.name;

  // Format creation & edit timestamps
  let timeStr = '';
  if (t.createdAt) {
    const dObj = new Date(t.createdAt);
    timeStr = `🕒 ${dObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    timeStr = `🕒 ${t.date}`;
  }
  if (t.updatedAt && Math.abs(t.updatedAt - (t.createdAt || 0)) > 1000) {
    const uObj = new Date(t.updatedAt);
    const sameDay = t.createdAt && new Date(t.createdAt).toDateString() === uObj.toDateString();
    const editTimeStr = sameDay
      ? uObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `${uObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${uObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    timeStr += ` · ✏️ edited ${editTimeStr}`;
  }

  const metaParts = [party, t.note, fund?.name].filter(Boolean);

  return `<div class="row-item txn-pill-row" data-view-txn="${t.id}" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
    <div style="flex:1;min-width:0;text-align:left">
      <span style="display:flex;align-items:center;gap:4px">
        ${(t.receipt || t.receiptId) ? '<span title="Receipt attached" style="font-size:13px">🧾</span>' : ''}
        <span style="font-weight:650">${esc(cat)}</span>
      </span>
      <small style="color:var(--ink-2);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${esc(metaParts.join(' · '))}
      </small>
      <small style="color:var(--ink-2);font-size:.72rem;opacity:.8;display:block">
        ${timeStr}
      </small>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <span class="amt ${t.type === 'in' ? 'pos' : ''}" style="font-weight:700">${t.type === 'in' ? '+' : '−'}${fmt(t.amount)}</span>
      <button type="button" class="btn-micro" data-edit-txn="${t.id}" title="Edit entry" style="font-size:13px;padding:4px 8px;border-radius:calc(var(--radius)*.4);cursor:pointer">✏️</button>
    </div>
  </div>`;
}

export async function openTxnDetail({ txn: t, fund, L }) {
  const cat = t.transferId ? 'Transfer' : L.allCategories.find(c => c.id === t.categoryId)?.name || 'General';
  const party = L.allParties.find(p => p.id === t.partyId)?.name;
  const createdDate = t.createdAt
    ? new Date(t.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : t.date;
  const updatedDate = t.updatedAt && Math.abs(t.updatedAt - (t.createdAt || 0)) > 1000
    ? new Date(t.updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const receiptUrl = t.receipt || (t.receiptId ? await store.getReceipt(t.receiptId) : null);

  openSheet(`
    <div class="txn-detail-sheet" style="display:grid;gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <span class="chip" style="background:var(--accent-soft);color:var(--accent);font-weight:700">${esc(cat)}</span>
          <h2 style="font-size:1.6rem;margin-top:6px" class="${t.type === 'in' ? 'pos' : 'neg'}">
            ${t.type === 'in' ? '+' : '−'}${fmt(t.amount)}
          </h2>
        </div>
        <button type="button" class="btn primary" id="detail-edit-btn" style="padding:6px 14px;font-size:.85rem">✏️ Edit Entry</button>
      </div>

      <div class="card glass" style="display:grid;gap:10px">
        <div style="display:flex;justify-content:space-between">
          <span class="muted">Fund</span>
          <b>${esc(fund?.name || 'Unknown')}</b>
        </div>
        ${party ? `
          <div style="display:flex;justify-content:space-between">
            <span class="muted">Party</span>
            <b>${esc(party)}</b>
          </div>` : ''}
        <div style="display:flex;justify-content:space-between">
          <span class="muted">Date</span>
          <span>${t.date}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span class="muted">Logged on</span>
          <span>🕒 ${createdDate}</span>
        </div>
        ${updatedDate ? `
          <div style="display:flex;justify-content:space-between">
            <span class="muted">Last modified</span>
            <span>✏️ ${updatedDate}</span>
          </div>` : ''}
        ${t.note ? `
          <div style="border-top:1px solid var(--glass-line);padding-top:8px">
            <span class="muted" style="display:block;margin-bottom:2px">Comment</span>
            <p style="margin:0">${esc(t.note)}</p>
          </div>` : ''}
      </div>

      ${receiptUrl ? `
        <div class="card glass" style="text-align:center;padding:14px">
          <span class="muted" style="display:block;margin-bottom:8px;font-size:.85rem">Payment Screenshot / Receipt 🧾</span>
          <img src="${receiptUrl}" alt="Receipt" style="max-width:100%;max-height:260px;border-radius:calc(var(--radius)*.6);border:1px solid var(--glass-line);cursor:pointer;object-fit:contain" id="receipt-zoom-trigger">
          <div style="margin-top:10px">
            <button type="button" class="btn" id="receipt-full-btn" style="font-size:.82rem;padding:4px 12px">🔍 View full receipt</button>
          </div>
        </div>
      ` : ''}
    </div>
  `, el => {
    el.querySelector('#detail-edit-btn')?.addEventListener('click', () => {
      closeSheet();
      openTxnSheet({ txn: t });
    });
    if (receiptUrl) {
      const viewReceipt = () => openReceiptViewer(receiptUrl);
      el.querySelector('#receipt-zoom-trigger')?.addEventListener('click', viewReceipt);
      el.querySelector('#receipt-full-btn')?.addEventListener('click', viewReceipt);
    }
  });
}

export function openReceiptViewer(receiptUrl) {
  openSheet(`
    <div style="text-align:center;padding:8px 0;display:grid;gap:12px">
      <h2 style="margin:0">Payment Receipt 🧾</h2>
      <img src="${receiptUrl}" alt="Full receipt" style="max-width:100%;max-height:72dvh;border-radius:calc(var(--radius)*.8);border:1px solid var(--glass-line);box-shadow:0 8px 24px rgba(0,0,0,.3);object-fit:contain">
      <div>
        <a href="${receiptUrl}" download="hisaab-receipt.webp" class="btn" style="padding:6px 16px;font-size:.85rem">📥 Download image</a>
      </div>
    </div>
  `);
}

export function openQuickExpense() {
  const L = store.live();
  if (!L.funds.length) return toast('Create a fund first! 🏦✨');
  const defaultFund = L.funds[0];

  openSheet(`
    <div style="display:grid;gap:14px;padding:4px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:1.3rem">⚡ Quick Expense</h2>
        <span class="muted" style="font-size:.8rem;font-weight:600">Fast Logging</span>
      </div>
      <form id="quick-form" class="form" style="display:grid;gap:12px">
        <label class="field">
          <span>Amount (₹)</span>
          <input name="amount" inputmode="decimal" required autocomplete="off" placeholder="0.00" autofocus style="font-size:1.5rem;font-weight:750">
        </label>
        <label class="field">
          <span>Fund</span>
          <select name="fundId">
            ${L.funds.map(f => `<option value="${f.id}" ${f.id === defaultFund.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Note (optional)</span>
          <input name="note" autocomplete="off" placeholder="e.g. Chai ☕ / Auto 🛺 / Samosa 🥟">
        </label>
        <div class="row" style="margin-top:6px">
          <button class="btn primary" style="width:100%;padding:14px;font-size:1rem">⚡ Log Expense Now</button>
        </div>
      </form>
    </div>
  `, el => {
    const amtInput = el.querySelector('[name=amount]');
    sanitizeAmountInput(amtInput);
    setTimeout(() => amtInput?.focus(), 100);

    el.querySelector('#quick-form').onsubmit = async e => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type=submit]');
      if (submitBtn?.disabled) return;
      const origText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Logging…';
      }
      try {
        const fd = new FormData(e.target);
        const amount = toMinor(fd.get('amount'));
        if (amount <= 0) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
          return toast('C’mon, zero paise needs no accounting! 😉');
        }
        const fundId = fd.get('fundId') || defaultFund.id;
        const note = (fd.get('note') || '').trim();

        const saveDoc = {
          type: 'out',
          amount,
          fundId,
          date: today(),
          categoryId: GENERAL_ID,
          note,
          partyId: ''
        };
        await store.saveTxn(saveDoc);
        const chillarRes = await checkAndApplyChillarSaver(saveDoc);
        closeSheet();
        let qMsg = `⚡ Boom! ${fmt(amount)} logged in a flash! ⏱️💨`;
        if (chillarRes) {
          qMsg += ` · +${fmt(chillarRes.chillar)} swept to 🏺 ${chillarRes.potName}`;
        }
        toast(qMsg);
      } catch (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
        toast(err.message || 'Failed to record entry');
      }
    };
  });
}

