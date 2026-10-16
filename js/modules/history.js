import { store } from '../core/store.js';
import { monthRange } from '../core/calc.js';
import { dateTs, today } from '../core/models.js';
import { esc, openSheet, closeSheet } from '../ui.js';
import { openTxnSheet, openTxnDetail, txnRow } from './txn-sheet.js';

let mode = 'month'; // 'date' | 'month' | 'year'
let cursor = new Date();
let fundFilter = 'all';
let searchQuery = '';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function render(root) {
  const L = store.live(), { allFunds, txns } = L, byId = Object.fromEntries(allFunds.map(f => [f.id, f]));

  // Calculate active date range depending on mode
  let startTs = 0, endTs = Infinity, rangeLabel = '';
  const y = cursor.getFullYear(), m = cursor.getMonth(), d = cursor.getDate();

  if (mode === 'date') {
    const curStr = cursor.toLocaleDateString('en-CA');
    startTs = dateTs(curStr);
    endTs = startTs + 86400000;
    rangeLabel = `${d} ${SHORT_MONTHS[m]} ${y}`;
  } else if (mode === 'year') {
    startTs = dateTs(`${y}-01-01`);
    endTs = dateTs(`${y + 1}-01-01`);
    rangeLabel = `${y}`;
  } else { // 'month'
    startTs = dateTs(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    endTs = m === 11 ? dateTs(`${y + 1}-01-01`) : dateTs(`${y}-${String(m + 2).padStart(2, '0')}-01`);
    rangeLabel = `${SHORT_MONTHS[m]} ${y}`;
  }

  // Filter and sort strictly NEWEST FIRST
  const allPeriodRows = txns.filter(t => {
    const s = dateTs(t.date);
    return s >= startTs && s < endTs && (fundFilter === 'all' || t.fundId === fundFilter);
  }).sort((p, q) => q.date.localeCompare(p.date) || (q.createdAt || 0) - (p.createdAt || 0));

  const catMap = Object.fromEntries(L.allCategories.map(c => [c.id, (c.name || '').toLowerCase()]));
  const partyMap = Object.fromEntries(L.allParties.map(p => [p.id, (p.name || '').toLowerCase()]));
  const fundMap = Object.fromEntries(allFunds.map(f => [f.id, (f.name || '').toLowerCase()]));

  const matchesSearch = (t, q) => {
    if (!q) return true;
    const note = (t.note || '').toLowerCase();
    const cat = catMap[t.categoryId] || '';
    const party = partyMap[t.partyId] || '';
    const fund = fundMap[t.fundId] || '';
    const amtStr = (t.amount / 100).toString();
    const dateStr = t.date || '';
    return note.includes(q) || cat.includes(q) || party.includes(q) || fund.includes(q) || amtStr.includes(q) || dateStr.includes(q);
  };

  const qTrim = searchQuery.toLowerCase().trim();
  const rows = allPeriodRows.filter(t => matchesSearch(t, qTrim));
  const days = [...new Set(rows.map(r => r.date))];

  root.innerHTML = `
    <div class="history-sticky-header" style="position:sticky;top:50px;z-index:10;background:color-mix(in srgb, var(--bg) 88%, transparent);padding:4px 0 10px;border-bottom:1px solid var(--glass-line);-webkit-backdrop-filter:blur(var(--blur));backdrop-filter:blur(var(--blur))">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <h1 style="margin:0;font-size:1.4rem;font-weight:750;letter-spacing:-.02em">History</h1>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="date-stepper-segmented" style="display:inline-flex;align-items:center;height:36px;background:var(--bg);border-radius:99px;box-shadow:3px 3px 8px var(--sh-lo),-3px -3px 8px var(--sh-hi);padding:2px">
            <button class="stepper-arrow-btn" data-step="-1" aria-label="Previous" style="width:32px;height:32px;border:0;background:none;color:var(--ink-2);cursor:pointer;font-size:1.1rem;display:grid;place-items:center;border-radius:50%">‹</button>
            <button class="stepper-label-btn" data-pick-date style="border:0;background:none;padding:0 8px;font-size:.84rem;font-weight:650;color:var(--ink);cursor:pointer;white-space:nowrap">${rangeLabel} ▾</button>
            <button class="stepper-arrow-btn" data-step="1" aria-label="Next" style="width:32px;height:32px;border:0;background:none;color:var(--ink-2);cursor:pointer;font-size:1.1rem;display:grid;place-items:center;border-radius:50%">›</button>
          </div>
          <label class="field" style="margin:0;min-width:82px;height:36px">
            <select data-mode aria-label="Granularity view" style="height:36px;padding:0 24px 0 10px;font-size:.82rem;font-weight:600;border-radius:99px;background:var(--bg);box-shadow:3px 3px 8px var(--sh-lo),-3px -3px 8px var(--sh-hi);border:1px solid var(--glass-line)">
              <option value="date" ${mode === 'date' ? 'selected' : ''}>Day</option>
              <option value="month" ${mode === 'month' ? 'selected' : ''}>Month</option>
              <option value="year" ${mode === 'year' ? 'selected' : ''}>Year</option>
            </select>
          </label>
          <label class="field d-only" style="margin:0;height:36px">
            <select data-fund aria-label="Filter by fund" style="height:36px;padding:0 24px 0 10px;font-size:.82rem;font-weight:600;border-radius:99px;background:var(--bg);box-shadow:3px 3px 8px var(--sh-lo),-3px -3px 8px var(--sh-hi);border:1px solid var(--glass-line)">
              <option value="all">All funds</option>
              ${allFunds.map(f => `<option value="${f.id}" ${f.id === fundFilter ? 'selected' : ''}>${esc(f.name)}${f.deleted ? ' (deleted)' : ''}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>

      <div style="margin-top:10px">
        <input type="search" id="history-search" placeholder="🔍 Search notes, categories, parties, amount…" value="${esc(searchQuery)}" autocomplete="off" style="width:100%;border:0;outline:0;padding:9px 14px;border-radius:calc(var(--radius)*.6);background:var(--bg);box-shadow:inset 3px 3px 7px var(--sh-lo),inset -3px -3px 7px var(--sh-hi);font-size:.86rem">
      </div>
    </div>

    <div id="history-list-wrap">
      ${days.map(dStr => `
        <section class="stack" data-day="${dStr}">
          <p class="day">${new Date(dStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: mode === 'year' ? 'numeric' : undefined })}</p>
          <div class="rows">${rows.filter(r => r.date === dStr).map(t => txnRow(t, byId[t.fundId], L)).join('')}</div>
        </section>
      `).join('') || `<div class="empty glass">${qTrim ? `No entries matching "${esc(searchQuery)}" for ${esc(rangeLabel)}` : `No entries for ${esc(rangeLabel)}! Your wallet was on its absolute best behavior 😇🪙`}</div>`}
    </div>`;

  let searchDebounce = null;
  const searchInput = root.querySelector('#history-search');
  if (searchInput) {
    searchInput.oninput = e => {
      searchQuery = e.target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const q = searchQuery.toLowerCase().trim();
        const sections = root.querySelectorAll('section.stack[data-day]');
        let visibleCount = 0;
        sections.forEach(sec => {
          const items = sec.querySelectorAll('[data-view-txn]');
          let dayVisible = 0;
          items.forEach(item => {
            const tid = item.dataset.viewTxn;
            const t = allPeriodRows.find(x => x.id === tid);
            const match = matchesSearch(t, q);
            item.closest('.row-item, [data-view-txn]').style.display = match ? '' : 'none';
            if (match) dayVisible++;
          });
          sec.style.display = dayVisible ? '' : 'none';
          visibleCount += dayVisible;
        });
        let emptyMsg = root.querySelector('#search-empty-msg');
        if (visibleCount === 0 && q) {
          if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'search-empty-msg';
            emptyMsg.className = 'empty glass';
            emptyMsg.style.marginTop = '12px';
            root.querySelector('#history-list-wrap').after(emptyMsg);
          }
          emptyMsg.textContent = `No transactions matching "${searchQuery}" found in ${rangeLabel}.`;
          emptyMsg.hidden = false;
        } else if (emptyMsg) {
          emptyMsg.hidden = true;
        }
      }, 150);
    };
  }

  root.onclick = e => {
    const step = e.target.closest('[data-step]');
    const pick = e.target.closest('[data-pick-date]');
    const editBtn = e.target.closest('[data-edit-txn]');
    const pill = e.target.closest('[data-view-txn]');

    if (step) {
      const delta = Number(step.dataset.step);
      if (mode === 'date') cursor.setDate(cursor.getDate() + delta);
      else if (mode === 'year') cursor.setFullYear(cursor.getFullYear() + delta);
      else cursor.setMonth(cursor.getMonth() + delta);
      cursor = new Date(cursor.getTime());
      render(root);
    } else if (pick) {
      openCalendarPicker(root);
    } else if (editBtn) {
      e.stopPropagation();
      const targetTxn = allPeriodRows.find(r => r.id === editBtn.dataset.editTxn);
      if (targetTxn) openTxnSheet({ txn: targetTxn });
    } else if (pill) {
      const targetTxn = allPeriodRows.find(r => r.id === pill.dataset.viewTxn);
      if (targetTxn) openTxnDetail({ txn: targetTxn, fund: byId[targetTxn.fundId], L });
    }
  };

  root.onchange = e => {
    if (e.target.matches('[data-mode]')) {
      mode = e.target.value;
      render(root);
    } else if (e.target.matches('[data-fund]')) {
      fundFilter = e.target.value;
      render(root);
    }
  };
}

function openCalendarPicker(root) {
  let viewYear = cursor.getFullYear();
  let viewMonth = cursor.getMonth();

  const renderPicker = el => {
    const isDayPicker = mode === 'date';
    
    // Grid days calculation
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push('<span class="cal-pad"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const isCur = cursor.getFullYear() === viewYear && cursor.getMonth() === viewMonth && cursor.getDate() === d;
      cells.push(`<button type="button" class="btn cal-day ${isCur ? 'primary' : ''}" data-day="${d}">${d}</button>`);
    }

    el.innerHTML = `
      <div style="display:grid;gap:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0">${mode === 'year' ? 'Select Year' : (mode === 'date' ? 'Select Date' : 'Select Month')}</h2>
          <button type="button" class="btn" id="cal-today-btn" style="padding:4px 10px;font-size:.8rem">Today</button>
        </div>

        <!-- Year Navigation Header -->
        <div style="display:flex;justify-content:space-between;align-items:center">
          <button type="button" class="btn" id="cal-prev-year">‹ Year</button>
          <strong style="font-size:1.15rem">${viewYear}</strong>
          <button type="button" class="btn" id="cal-next-year">Year ›</button>
        </div>

        ${mode === 'year' ? `
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px">
            ${Array.from({ length: 12 }, (_, i) => viewYear - 5 + i).map(yr => `
              <button type="button" class="btn ${cursor.getFullYear() === yr ? 'primary' : ''}" data-pick-yr="${yr}">${yr}</button>
            `).join('')}
          </div>
        ` : `
          <!-- 12 Months Grid -->
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px">
            ${SHORT_MONTHS.map((mName, idx) => `
              <button type="button" class="btn ${viewMonth === idx ? 'primary' : ''}" data-pick-mo="${idx}" style="padding:8px 4px;font-size:.88rem">
                ${mName}
              </button>
            `).join('')}
          </div>
        `}

        ${isDayPicker ? `
          <div style="margin-top:6px">
            <div style="display:grid;grid-template-columns:repeat(7, 1fr);text-align:center;font-size:.75rem;color:var(--ink-2);margin-bottom:6px">
              <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(7, 1fr);gap:4px">
              ${cells.join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    el.querySelector('#cal-prev-year')?.addEventListener('click', () => { viewYear--; renderPicker(el); });
    el.querySelector('#cal-next-year')?.addEventListener('click', () => { viewYear++; renderPicker(el); });
    el.querySelector('#cal-today-btn')?.addEventListener('click', () => {
      cursor = new Date();
      closeSheet();
      render(root);
    });

    el.querySelectorAll('[data-pick-yr]').forEach(btn => {
      btn.onclick = () => {
        cursor = new Date(Number(btn.dataset.pickYr), 0, 1);
        closeSheet();
        render(root);
      };
    });

    el.querySelectorAll('[data-pick-mo]').forEach(btn => {
      btn.onclick = () => {
        viewMonth = Number(btn.dataset.pickMo);
        if (mode === 'month') {
          cursor = new Date(viewYear, viewMonth, 1);
          closeSheet();
          render(root);
        } else {
          renderPicker(el);
        }
      };
    });

    el.querySelectorAll('[data-day]').forEach(btn => {
      btn.onclick = () => {
        cursor = new Date(viewYear, viewMonth, Number(btn.dataset.day));
        closeSheet();
        render(root);
      };
    });
  };

  openSheet('<div id="cal-container"></div>', container => {
    renderPicker(container.querySelector('#cal-container'));
  });
}
