import { store } from '../core/store.js';
import { potBalance, potVelocity, monthRange } from '../core/calc.js';
import { fmt, toMinor, fromMinor, today, uid } from '../core/models.js';
import { POT_CUSTODY, GENERAL_ID } from '../config.js';
import { esc, dot, openSheet, closeSheet, toast, confirmModal, promptModal } from '../ui.js';
import { sanitizeAmountInput } from './txn-sheet.js';

export function render(root, id) {
  id ? detail(root, id) : list(root);
}

function list(root) {
  const L = store.live();
  const pots = L.pots;
  const brokenPots = L.allPots.filter(p => p.broken);

  const totalSaved = pots.reduce((acc, p) => acc + potBalance(p, L.txns), 0);
  const totalTarget = pots.reduce((acc, p) => acc + (p.targetAmount || 0), 0);
  const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 100;

  root.innerHTML = `
    <header class="top">
      <div>
        <h1>Pots</h1>
        <p class="muted" style="font-size:.82rem">Dedicated savings reservoirs · <a href="#/funds" style="color:var(--accent);font-weight:600">Switch to Funds 💼 ›</a></p>
      </div>
      <button class="btn primary" data-new-pot>+ New Pot</button>
    </header>

    ${pots.length ? `
      <div class="card glass" style="margin-bottom:20px;padding:16px;border-left:4px solid var(--accent)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <span class="label" style="text-transform:uppercase;font-weight:700">Total Savings in Pots</span>
            <div style="font-size:1.8rem;font-weight:800;color:var(--ink);margin-top:2px">${fmt(totalSaved)}</div>
            ${totalTarget > 0 ? `<span class="muted" style="font-size:.8rem">Target: ${fmt(totalTarget)} (${overallPct}% reached)</span>` : ''}
          </div>
          <div style="min-width:140px;flex:1;max-width:260px">
            <div class="meter inset" style="height:10px;margin-top:8px"><i style="width:${overallPct}%;background:var(--accent)"></i></div>
          </div>
        </div>
      </div>
    ` : ''}

    <section class="stack">
      <div class="grid grid-funds">
        ${pots.map(p => potCard(p, L)).join('')}
      </div>

      ${!pots.length ? `
        <div class="empty glass">
          <p style="font-size:1.05rem;font-weight:600;margin-bottom:6px">🏺 No Active Pots Yet</p>
          <p class="muted" style="margin-bottom:14px">Create a dedicated Pot for anything you are saving towards: an emergency fund, travel, electronics, or physical cash in a safe box.</p>
          <button class="btn primary" data-new-pot>Create Your First Pot</button>
        </div>
      ` : ''}

      ${brokenPots.length ? `
        <details class="settings-acc" style="margin-top:20px">
          <summary>
            <div class="acc-title"><span>📜</span><span>Liquidated / Broken Pots (${brokenPots.length})</span></div>
            <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="acc-body" style="padding:10px 14px">
            <p class="muted" style="font-size:.82rem;margin-bottom:8px">Pots that reached their target or were broken. All historical deposits and statements remain intact.</p>
            <div class="rows">
              ${brokenPots.map(p => `
                <a class="row-item" href="#/pots/${p.id}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px">
                  <span style="display:flex;align-items:center;gap:8px">
                    ${dot(p.hue)}
                    <span style="font-weight:600">${esc(p.name)}</span>
                    <span class="badge" style="font-size:.7rem">Liquidated</span>
                  </span>
                  <small style="color:var(--ink-2)">View ledger ›</small>
                </a>
              `).join('')}
            </div>
          </div>
        </details>
      ` : ''}
    </section>
  `;

  root.onclick = e => {
    if (e.target.closest('[data-new-pot]')) openPotSheet();
  };
}

function potCard(p, L) {
  const bal = potBalance(p, L.txns);
  const vel = potVelocity(p, bal);
  const custodyMeta = POT_CUSTODY[p.custody] || POT_CUSTODY.custom;

  return `
    <a class="tile raised" href="#/pots/${p.id}" style="position:relative;display:flex;flex-direction:column;justify-content:space-between">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <span style="font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:6px">
            ${dot(p.hue)}${esc(p.name)}
          </span>
          <div style="display:flex;gap:4px;align-items:center">
            ${p.locked ? '<span title="Discipline Lock Active" style="font-size:.85rem">🔒</span>' : ''}
            <span class="badge" style="font-size:.7rem;padding:2px 6px">${custodyMeta.icon} ${esc(p.custodyName || custodyMeta.label)}</span>
          </div>
        </div>

        <div style="margin-top:12px">
          <b style="font-size:1.4rem;color:var(--ink)">${fmt(bal)}</b>
          ${p.targetAmount ? `<span class="muted" style="font-size:.8rem;display:block">Target: ${fmt(p.targetAmount)}</span>` : ''}
        </div>
      </div>

      <div style="margin-top:14px">
        ${p.targetAmount ? `
          <div class="meter inset" style="height:7px;margin-bottom:6px">
            <i style="width:${vel.pct}%;background:hsl(${p.hue} 60% 50%)"></i>
          </div>
          <span class="label" style="font-size:.75rem;color:var(--ink-2)">${esc(vel.label)}</span>
        ` : `<span class="label" style="font-size:.75rem;color:var(--ink-2)">No target deadline</span>`}
      </div>
    </a>
  `;
}

function detail(root, id) {
  const L = store.live();
  const p = L.allPots.find(x => x.id === id);
  if (!p) { location.hash = '#/pots'; return; }

  const bal = potBalance(p, L.txns);
  const vel = potVelocity(p, bal);
  const custodyMeta = POT_CUSTODY[p.custody] || POT_CUSTODY.custom;
  const potTxns = L.txns.filter(t => t.potId === id).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  root.innerHTML = `
    <header class="top">
      <div>
        <a class="muted" href="#/pots" style="font-size:.88rem">‹ Pots</a>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <h1>${dot(p.hue)}${esc(p.name)}</h1>
          ${p.locked ? '<span title="Discipline Lock Active" style="font-size:1.1rem">🔒</span>' : ''}
          ${p.broken ? '<span class="badge" style="font-size:.75rem">Liquidated</span>' : ''}
        </div>
        <p class="muted" style="font-size:.82rem">
          Custody: ${custodyMeta.icon} <b>${esc(p.custodyName || custodyMeta.label)}</b>
          ${p.targetDate ? ` · Target Deadline: <b>${p.targetDate}</b>` : ''}
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="btn-edit-pot">Edit Pot</button>
      </div>
    </header>

    <section class="hero raised">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <span class="label">Current Accumulated Savings</span>
          <strong class="big pos">${fmt(bal)}</strong>
          ${p.targetAmount ? `<div class="muted" style="font-size:.84rem;margin-top:2px">Goal Target: <b>${fmt(p.targetAmount)}</b> (${vel.pct}% saved)</div>` : ''}
        </div>
        <div style="text-align:right">
          <span class="label">Velocity Status</span>
          <div style="font-size:.9rem;font-weight:700;color:var(--accent);margin-top:4px">${esc(vel.label)}</div>
        </div>
      </div>

      ${p.targetAmount ? `
        <div class="meter inset" style="height:10px;margin-top:12px">
          <i style="width:${vel.pct}%;background:hsl(${p.hue} 60% 50%)"></i>
        </div>
      ` : ''}

      <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:8px">
        ${!p.broken ? `
          <button class="btn primary" id="btn-deposit">+ Deposit Money</button>
          <button class="btn" id="btn-withdraw">− Withdraw</button>
          <button class="btn danger" id="btn-break">🔨 Break Pot</button>
        ` : `
          <div class="card glass" style="width:100%;padding:10px">
            <span class="muted" style="font-size:.84rem">This Pot was broken and liquidated. Records are preserved below.</span>
          </div>
        `}
      </div>
    </section>

    <section class="stack" style="margin-top:24px">
      <h2>Pot Ledger &amp; History (${potTxns.length})</h2>
      <div class="rows">
        ${potTxns.map(t => {
          const fund = L.allFunds.find(f => f.id === t.fundId);
          const isDeposit = t.type === 'in';
          return `
            <div class="row-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px">
              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-weight:600">${esc(t.note || (isDeposit ? 'Deposit' : 'Withdrawal'))}</span>
                  ${t.isChillar ? '<span class="badge" style="font-size:.7rem">Chillar Round-up</span>' : ''}
                </div>
                <small class="muted" style="display:block;margin-top:2px">
                  <span>${t.date}</span> · <span>${isDeposit ? 'Funded from' : 'Withdrawn to'}: <b>${esc(fund?.name || 'External Fund')}</b></span>
                </small>
              </div>
              <div style="text-align:right">
                <b class="${isDeposit ? 'pos' : 'neg'}" style="font-size:1.1rem">
                  ${isDeposit ? '+' : '−'}${fmt(t.amount)}
                </b>
              </div>
            </div>
          `;
        }).join('') || '<div class="empty glass"><p>No activity yet in this Pot. Deposit money from an operational fund to begin saving!</p></div>'}
      </div>
    </section>
  `;

  root.onclick = async e => {
    const t = e.target;
    if (t.closest('#btn-edit-pot')) {
      openPotSheet(p, () => detail(root, id));
    } else if (t.closest('#btn-deposit')) {
      openPotDepositSheet(p, () => detail(root, id));
    } else if (t.closest('#btn-withdraw')) {
      openPotWithdrawSheet(p, bal, () => detail(root, id));
    } else if (t.closest('#btn-break')) {
      openPotBreakSheet(p, bal, () => detail(root, id));
    }
  };
}

function openPotSheet(pot, onDone) {
  const L = store.live();
  const d = pot || {
    name: '',
    targetAmount: 0,
    targetDate: '',
    custody: 'wallet',
    custodyName: '',
    locked: false,
    autoSweep: null,
    hue: 160
  };

  const el = openSheet(`
    <header class="sheet-head">
      <h2>${pot ? 'Edit Pot' : 'New Savings Pot 🏺'}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <form id="pot-form" style="display:grid;gap:14px;padding:14px">
      <label class="field">
        <span>Pot Name</span>
        <input name="name" required class="dialog-input" placeholder="e.g. Emergency Safe, Laptop 2027, Gold Coin" value="${esc(d.name)}">
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="field">
          <span>Target Goal Amount (₹)</span>
          <input name="targetAmount" inputmode="decimal" class="dialog-input" placeholder="0.00" value="${d.targetAmount ? fromMinor(d.targetAmount) : ''}">
        </label>
        <label class="field">
          <span>Target Deadline</span>
          <input type="date" name="targetDate" class="dialog-input" value="${esc(d.targetDate)}">
        </label>
      </div>

      <label class="field">
        <span>Physical Custody / Storage Method</span>
        <select name="custody" class="dialog-input">
          ${Object.entries(POT_CUSTODY).map(([k, v]) => `
            <option value="${k}" ${d.custody === k ? 'selected' : ''}>${v.icon} ${v.label} — ${v.hint}</option>
          `).join('')}
        </select>
      </label>

      <label class="field">
        <span>Storage Details / Identifier (optional)</span>
        <input name="custodyName" class="dialog-input" placeholder="e.g. PhonePe Wallet, Safe Box 2, ICICI iWish" value="${esc(d.custodyName || '')}">
      </label>

      <label class="field" style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-top:4px">
        <input type="checkbox" name="locked" ${d.locked ? 'checked' : ''} style="width:18px;height:18px">
        <div>
          <span style="font-weight:600">🔒 Discipline Lock</span>
          <small class="muted" style="display:block">Adds reflection confirmation on withdrawals to prevent impulsive spending.</small>
        </div>
      </label>

      <div style="display:flex;gap:10px;margin-top:12px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">${pot ? 'Save Changes' : 'Create Pot'}</button>
      </div>
    </form>
  `);

  sanitizeAmountInput(el.querySelector('[name=targetAmount]'));

  el.querySelector('#pot-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = fd.get('name').trim();
    const targetAmount = toMinor(fd.get('targetAmount'));
    const targetDate = fd.get('targetDate');
    const custody = fd.get('custody');
    const custodyName = fd.get('custodyName').trim();
    const locked = fd.get('locked') === 'on';

    await store.savePot({
      ...d,
      name,
      targetAmount,
      targetDate,
      custody,
      custodyName,
      locked
    });

    closeSheet();
    toast(pot ? 'Pot details sharpened and saved! 🏺✨' : 'New Pot opened! Ready to receive savings 🏺🍯');
    onDone ? onDone() : location.reload();
  };
}

function openPotDepositSheet(pot, onDone) {
  const L = store.live();
  if (!L.funds.length) {
    return toast('You need at least one operational fund to deposit from!');
  }

  const el = openSheet(`
    <header class="sheet-head">
      <h2>Deposit into ${esc(pot.name)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <form id="deposit-form" style="display:grid;gap:14px;padding:14px">
      <p class="muted" style="font-size:.84rem">
        Transfer money from your operational bank or cash account into this savings Pot.
      </p>

      <label class="field">
        <span>Amount to Deposit (₹)</span>
        <input name="amount" required inputmode="decimal" class="dialog-input" placeholder="0.00" autofocus>
      </label>

      <label class="field">
        <span>Source Operational Fund</span>
        <select name="fundId" class="dialog-input" required>
          ${L.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
        </select>
      </label>

      <label class="field">
        <span>Note / Purpose (optional)</span>
        <input name="note" class="dialog-input" placeholder="e.g. Monthly savings stash">
      </label>

      <div style="display:flex;gap:10px;margin-top:10px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">Confirm Deposit</button>
      </div>
    </form>
  `);

  sanitizeAmountInput(el.querySelector('[name=amount]'));

  el.querySelector('#deposit-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = toMinor(fd.get('amount'));
    if (amount <= 0) return toast('Please enter a valid deposit amount!');

    const fundId = fd.get('fundId');
    const note = fd.get('note').trim() || `Deposit to ${pot.name}`;

    await store.saveTxn({
      fundId,
      potId: pot.id,
      type: 'in', // Enters pot
      amount,
      categoryId: GENERAL_ID,
      note,
      date: today()
    });

    closeSheet();
    toast(`Deposited ${fmt(amount)} into 🏺 ${pot.name}! Steady progress ✨`);
    onDone?.();
  };
}

function openPotWithdrawSheet(pot, currentBal, onDone) {
  const L = store.live();
  if (currentBal <= 0) {
    return toast('This Pot has zero accumulated funds to withdraw!');
  }
  if (!L.funds.length) {
    return toast('You need at least one operational fund to withdraw into!');
  }

  const proceedWithModal = () => {
    const el = openSheet(`
      <header class="sheet-head">
        <h2>Withdraw from ${esc(pot.name)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </header>
      <form id="withdraw-form" style="display:grid;gap:14px;padding:14px">
        <p class="muted" style="font-size:.84rem">
          Available in Pot: <b>${fmt(currentBal)}</b>. Enter the amount to return to your operational account.
        </p>

        <label class="field">
          <span>Amount to Withdraw (₹)</span>
          <input name="amount" required inputmode="decimal" class="dialog-input" placeholder="0.00" autofocus>
        </label>

        <label class="field">
          <span>Destination Operational Fund</span>
          <select name="fundId" class="dialog-input" required>
            ${L.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
          </select>
        </label>

        <label class="field">
          <span>Reason for Withdrawal</span>
          <input name="note" class="dialog-input" placeholder="e.g. Emergency expense / Purchased target item" required>
        </label>

        <div style="display:flex;gap:10px;margin-top:10px">
          <button type="button" class="btn" data-close style="flex:1">Cancel</button>
          <button type="submit" class="btn primary" style="flex:1">Confirm Withdrawal</button>
        </div>
      </form>
    `);

    sanitizeAmountInput(el.querySelector('[name=amount]'));

    el.querySelector('#withdraw-form').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = toMinor(fd.get('amount'));
      if (amount <= 0) return toast('Please enter a valid amount!');
      if (amount > currentBal) return toast(`Cannot withdraw more than available pot balance (${fmt(currentBal)})!`);

      const fundId = fd.get('fundId');
      const note = fd.get('note').trim() || `Withdrawal from ${pot.name}`;

      await store.saveTxn({
        fundId,
        potId: pot.id,
        type: 'out', // Leaves pot
        amount,
        categoryId: GENERAL_ID,
        note,
        date: today()
      });

      closeSheet();
      toast(`Withdrew ${fmt(amount)} from 🏺 ${pot.name}!`);
      onDone?.();
    };
  };

  // Discipline Lock Guard
  if (pot.locked) {
    confirmModal({
      title: '🔒 Discipline Lock Intercept',
      message: `You enabled Discipline Lock on "${pot.name}". Are you sure you want to withdraw from your savings target? Take a second to reflect on whether this is an absolute necessity.`,
      confirmText: 'Yes, Proceed with Withdrawal'
    }).then(ok => {
      if (ok) proceedWithModal();
    });
  } else {
    proceedWithModal();
  }
}

function openPotBreakSheet(pot, currentBal, onDone) {
  const L = store.live();
  const destFunds = L.funds;
  if (!destFunds.length) return toast('You need an operational fund to receive the liquidated money!');

  const doBreak = async () => {
    const ok = await confirmModal({
      title: '🔨 Break & Liquidate Pot?',
      message: `Break "${pot.name}" completely? All remaining ${fmt(currentBal)} will be swept into your operational account, and this Pot will be retired into audit history.`,
      confirmText: 'Break Pot Now',
      danger: true
    });
    if (!ok) return;

    if (currentBal > 0) {
      await store.saveTxn({
        fundId: destFunds[0].id,
        potId: pot.id,
        type: 'out',
        amount: currentBal,
        categoryId: GENERAL_ID,
        note: `Pot Break & Full Liquidation 🔨 (${pot.name})`,
        date: today()
      });
    }

    await store.breakPot(pot);
    toast(`Pot broken! ${fmt(currentBal)} returned to ${destFunds[0].name} 🔨✨`);
    onDone ? onDone() : location.reload();
  };

  // Discipline Lock Guard
  if (pot.locked) {
    confirmModal({
      title: '🔒 Discipline Lock Intercept',
      message: `"${pot.name}" has Discipline Lock turned ON. Smashing a savings pot is a permanent decision. Do you truly want to liquidate this entire savings vehicle?`,
      confirmText: 'Yes, Smash the Pot',
      danger: true
    }).then(ok => {
      if (ok) doBreak();
    });
  } else {
    doBreak();
  }
}
