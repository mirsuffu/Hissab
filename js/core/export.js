// Statement engine: filter -> model -> any output (CSV, text, HTML for PDF/Excel/Word, PNG image).
import { fmt } from './models.js';
import { fundSigned } from './calc.js';
import { ABADI_REGULAR_B64, ABADI_BOLD_B64 } from './fonts.js';

export const FIELDS = { date: 'Date', fund: 'Fund', category: 'Category', party: 'Party', type: 'Type', amount: 'Amount', comment: 'Comment', balance: 'Balance', id: 'Entry ID', edited: 'Last edited' };
export const DEFAULT_FIELDS = ['date', 'fund', 'category', 'party', 'type', 'amount', 'comment'];


export function buildModel(L, o) {
  const map = l => Object.fromEntries(l.map(x => [x.id, x.name]));
  const fund = map(L.allFunds), cat = map(L.allCategories), party = map(L.allParties);
  const inPeriod = d => ({ day: d === o.date, month: d.startsWith(o.month), year: d.startsWith(o.year), range: (!o.from || d >= o.from) && (!o.to || d <= o.to), all: true })[o.period];
  const isFundInflow = t => (t.potId ? t.type === 'out' : t.type === 'in');
  let rows = L.txns.filter(t => inPeriod(t.date) && (!o.fundId || t.fundId === o.fundId) && (!o.categoryId || t.categoryId === o.categoryId)
      && (!o.partyId || t.partyId === o.partyId) && (o.type === 'all' || (o.type === 'in' ? isFundInflow(t) : !isFundInflow(t))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let balBf = 0;
  if (o.fundId) {
    const fObj = L.allFunds.find(x => x.id === o.fundId);
    balBf += (fObj?.opening || 0);
  } else {
    balBf += L.funds.reduce((sum, f) => sum + (f.opening || 0), 0);
  }

  const isBeforePeriod = d => {
    if (o.period === 'all') return false;
    if (o.period === 'month' && o.month) return d < (o.month + '-01');
    if (o.period === 'year' && o.year) return d < (o.year + '-01-01');
    if (o.period === 'day' && o.date) return d < o.date;
    if (o.period === 'range' && o.from) return d < o.from;
    return false;
  };

  const priorTxns = L.txns.filter(t => isBeforePeriod(t.date) && (!o.fundId || t.fundId === o.fundId));
  for (const t of priorTxns) {
    balBf += fundSigned(t);
  }

  let bal = balBf, income = 0, expense = 0;
  rows = rows.map(t => {
    const s = fundSigned(t);
    bal += s;
    if (!t.potId) {
      s > 0 ? (income += s) : (expense -= s);
    }
    return { t, bal };
  });
  if (o.sort === 'desc') rows.reverse();
  const toDDMMYYYY = d => {
    if (!d) return '—';
    const p = d.split('-');
    return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
  };
  const pad = n => String(n).padStart(2, '0');
  const fmtStatementAmt = paise => {
    const n = Math.abs(paise) / 100;
    return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const cell = {
    date: r => toDDMMYYYY(r.t.date),
    fund: r => fund[r.t.fundId] || '',
    category: r => r.t.potId ? 'Pot Transfer' : (cat[r.t.categoryId] || 'General'),
    party: r => party[r.t.partyId] || '—',
    type: r => {
      if (r.t.potId) return r.t.type === 'in' ? 'To Pot' : 'From Pot';
      return r.t.type === 'in' ? 'Received' : 'Sent';
    },
    amount: r => fmtStatementAmt(r.t.amount),
    comment: r => r.t.note || '—',
    balance: r => fmtStatementAmt(r.bal),
    id: r => r.t.id.slice(0, 8),
    edited: r => toDDMMYYYY(new Date(r.t.updatedAt || r.t.createdAt).toISOString().slice(0, 10)),
  };
  const cols = o.fields.filter(f => cell[f]);
  const keyOf = { date: cell.date, category: cell.category, party: r => cell.party(r) || 'No party', fund: cell.fund }[o.groupBy];
  const buckets = new Map();
  for (const r of rows) { const k = keyOf ? keyOf(r) : ''; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
  const month = o.month && new Date(o.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const label = { day: o.date, month, year: o.year, range: `${o.from || '…'} to ${o.to || '…'}`, all: 'All time' }[o.period];
  const extra = [o.fundId && `Fund: ${fund[o.fundId]}`, o.categoryId && `Category: ${cat[o.categoryId]}`, o.partyId && `Party: ${party[o.partyId]}`, o.type !== 'all' && (o.type === 'in' ? 'Received only' : 'Spent only')].filter(Boolean);

  let userName = L.profile?.name || '';
  let userEmail = '';
  try {
    const u = JSON.parse(localStorage.getItem('hisaab.cloud_user') || 'null');
    if (u?.displayName && !userName) userName = u.displayName;
    if (u?.email) userEmail = u.email;
  } catch {}
  if (!userName) userName = 'Mir Sufiyan Ali';
  if (!userEmail) userEmail = 'abc@email.com';

  let fromDate = '', toDate = '', periodStr = '';
  if (o.period === 'day') {
    fromDate = toDDMMYYYY(o.date);
    toDate = toDDMMYYYY(o.date);
    periodStr = '1 Day';
  } else if (o.period === 'month') {
    const mStr = o.month || (new Date().toISOString().slice(0, 7));
    const [y, mNum] = mStr.split('-').map(Number);
    const days = new Date(y, mNum, 0).getDate();
    fromDate = toDDMMYYYY(`${mStr}-01`);
    toDate = toDDMMYYYY(`${mStr}-${pad(days)}`);
    periodStr = `${days} Days`;
  } else if (o.period === 'year') {
    const yStr = o.year || (new Date().toISOString().slice(0, 4));
    const y = Number(yStr);
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    fromDate = toDDMMYYYY(`${yStr}-01-01`);
    toDate = toDDMMYYYY(`${yStr}-12-31`);
    periodStr = `${isLeap ? 366 : 365} Days`;
  } else if (o.period === 'range') {
    const fDate = o.from || (rows[0]?.t.date || (new Date().toISOString().slice(0, 10)));
    const tDate = o.to || (new Date().toISOString().slice(0, 10));
    fromDate = toDDMMYYYY(fDate);
    toDate = toDDMMYYYY(tDate);
    const d1 = new Date(fDate), d2 = new Date(tDate);
    const diff = Math.max(1, Math.round(Math.abs(d2 - d1) / 86400000) + 1);
    periodStr = `${diff} Days`;
  } else {
    const first = rows[0]?.t.date || (new Date().toISOString().slice(0, 10));
    const last = rows[rows.length - 1]?.t.date || (new Date().toISOString().slice(0, 10));
    fromDate = toDDMMYYYY(first);
    toDate = toDDMMYYYY(last);
    const d1 = new Date(first), d2 = new Date(last);
    const diff = Math.max(1, Math.round(Math.abs(d2 - d1) / 86400000) + 1);
    periodStr = `${diff} Days`;
  }

  const now = new Date();
  const nowDDMM = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  let h = now.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const timeStr = `${pad(h)}:${pad(now.getMinutes())} ${ampm}`;
  const exportedAt = `${nowDDMM} | ${timeStr}`;

  const meta = {
    name: userName,
    email: userEmail,
    from: fromDate,
    to: toDate,
    period: periodStr,
    exportedAt,
    appUrl: 'https://hisaab-suf-01-fceb1.web.app/'
  };

  return {
    title: (!o.title || o.title === 'Statement') ? 'Hissab Statement' : o.title,
    subtitle: [label, ...extra].join(' · '),
    cols: cols.map(c => FIELDS[c]),
    colKeys: cols,
    right: cols.map(c => c === 'amount' || c === 'balance'),
    groups: [...buckets].map(([title, rs]) => ({ title, rows: rs.map(r => cols.map(c => cell[c](r))) })),
    totals: { income, expense, net: income - expense, count: rows.length },
    showTotals: o.totals,
    meta,
  };
}

const q = s => `"${String(s).replace(/"/g, '""')}"`;
export const toCSV = m => '\ufeff' + [m.cols, ...m.groups.flatMap(g => g.rows)].map(r => r.map(q).join(',')).join('\r\n');
export function toText(m) {
  const out = [m.title, m.subtitle, ''];
  for (const g of m.groups) { if (g.title) out.push(`— ${g.title} —`); g.rows.forEach(r => out.push(r.filter(Boolean).join('  '))); out.push(''); }
  if (m.showTotals) out.push(`Received: ${fmt(m.totals.income)}  Spent: ${fmt(m.totals.expense)}  Net: ${fmt(m.totals.net)}  (${m.totals.count} entries)`);
  return out.join('\n').trim();
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toHTML(m, tpl = 'glass') {
  const isDark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'ink';
  const meta = m.meta || {
    name: 'Mir Sufiyan Ali',
    email: 'abc@email.com',
    from: '—',
    to: '—',
    period: '—',
    exportedAt: '—',
    appUrl: 'https://hisaab-suf-01-fceb1.web.app/'
  };

  const colWidths = {
    date: '12%',
    fund: '18%',
    category: '15%',
    party: '14%',
    type: '14%',
    amount: '13%',
    comment: '14%'
  };

  const headerCells = m.cols.map((c, i) => {
    const k = m.colKeys?.[i] || '';
    const w = colWidths[k] ? ` style="width:${colWidths[k]}"` : '';
    return `<th${w}>${esc(c)}</th>`;
  }).join('');

  const bodyRows = m.groups.map(g => (g.title ? `<tr><th colspan="${m.cols.length}" style="text-align:left;background:rgba(255,255,255,0.92);padding:6px 10px">${esc(g.title)}</th></tr>` : '') +
    g.rows.map(r => `<tr>${r.map(c => `<td title="${esc(c)}">${esc(c)}</td>`).join('')}</tr>`).join('')).join('');

  const totalsRow = m.showTotals ? `
    <tr style="font-weight:700">
      <td colspan="${Math.max(1, m.cols.length - 2)}" style="text-align:right;padding-right:12px;background:rgba(255,255,255,0.94)">
        Received ${fmt(m.totals.income)} · Spent ${fmt(m.totals.expense)} · Net
      </td>
      <td style="font-weight:700;background:rgba(255,255,255,0.94)">${fmt(m.totals.net)}</td>
      <td style="font-size:10pt;color:#4b5563;background:rgba(255,255,255,0.94)">${m.totals.count} entries</td>
    </tr>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(m.title)}</title>
  <style>
    @font-face {
      font-family: 'Abadi';
      src: url('data:font/truetype;charset=utf-8;base64,${ABADI_REGULAR_B64}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'Abadi';
      src: url('data:font/truetype;charset=utf-8;base64,${ABADI_BOLD_B64}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @page {
      size: A4 landscape;
      margin: 8mm 10mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    :root {
      --bg-gradient: ${isDark ? 'linear-gradient(135deg, #090e16 0%, #111823 60%, #1a1622 100%)' : 'linear-gradient(135deg, #cfe9e0 0%, #cdd6f7 60%, #f7d9cf 100%)'};
      --card-bg: ${isDark ? 'rgba(18, 24, 34, 0.85)' : 'rgba(255, 255, 255, 0.76)'};
      --card-border: ${isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.92)'};
      --text: ${isDark ? '#e5e7eb' : '#111827'};
      --heading: ${isDark ? '#ffffff' : '#000000'};
      --border: ${isDark ? '#3b4554' : '#000000'};
      --th-bg: ${isDark ? 'rgba(30, 41, 56, 0.96)' : 'rgba(255, 255, 255, 0.96)'};
      --td-bg: ${isDark ? 'rgba(22, 30, 42, 0.88)' : 'rgba(255, 255, 255, 0.88)'};
      --link: ${isDark ? '#60a5fa' : '#0563C1'};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      font-family: 'Abadi', Arial, sans-serif;
      color: var(--text);
      background: var(--bg-gradient);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      line-height: 1.35;
    }
    body {
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .statement-wrap {
      background: var(--card-bg);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 22px 28px 18px 28px;
      box-shadow: 0 10px 36px rgba(0, 0, 0, 0.06);
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .statement-top {
      flex: 1;
    }
    .title-box {
      text-align: center;
      margin-bottom: 18px;
    }
    .statement-title {
      font-family: 'Abadi', Arial, sans-serif;
      font-size: 22pt;
      font-weight: 700;
      color: var(--heading);
      display: inline-block;
      border-bottom: 1.4px solid var(--heading);
      padding-bottom: 2px;
      line-height: 1.15;
    }
    .meta-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      font-size: 11.5pt;
      margin-bottom: 20px;
    }
    .meta-col {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .meta-col.right {
      text-align: right;
    }
    .meta-line {
      display: flex;
      gap: 4px;
    }
    .meta-col.right .meta-line {
      justify-content: flex-end;
    }
    .meta-label {
      font-weight: 400;
    }
    .meta-val {
      font-weight: 400;
    }
    .email-link {
      color: var(--link);
      text-decoration: underline;
    }
    table.statement-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 4px;
    }
    table.statement-table th {
      font-family: 'Abadi', Arial, sans-serif;
      font-size: 11.5pt;
      font-weight: 700;
      color: var(--heading);
      background: var(--th-bg);
      border: 0.55pt solid var(--border);
      padding: 6px 4px;
      text-align: center;
      vertical-align: middle;
      white-space: nowrap;
    }
    table.statement-table td {
      font-family: 'Abadi', Arial, sans-serif;
      font-size: 11pt;
      color: var(--text);
      background: var(--td-bg);
      border: 0.5pt solid var(--border);
      padding: 5.5px 6px;
      text-align: center;
      vertical-align: middle;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .statement-footer {
      margin-top: auto;
      padding-top: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11pt;
      color: var(--text);
    }
    .statement-footer a {
      color: inherit;
      text-decoration: none;
    }
    @media print {
      body {
        padding: 0;
        background: var(--bg-gradient) !important;
      }
      .statement-wrap {
        border-radius: 8px;
        box-shadow: none;
        padding: 16px 20px 14px 20px;
      }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <div class="statement-wrap">
    <div class="statement-top">
      <div class="title-box">
        <h1 class="statement-title">${esc(m.title)}</h1>
      </div>
      <div class="meta-box">
        <div class="meta-col left">
          <div class="meta-line"><span class="meta-label">Name:</span> <span class="meta-val">${esc(meta.name)}</span></div>
          <div class="meta-line"><span class="meta-label">Email:</span> <a href="mailto:${esc(meta.email)}" class="email-link">${esc(meta.email)}</a></div>
          <div class="meta-line"><span class="meta-label">Exported At:</span> <span class="meta-val">${esc(meta.exportedAt)}</span></div>
        </div>
        <div class="meta-col right">
          <div class="meta-line"><span class="meta-label">From:</span> <span class="meta-val">${esc(meta.from)}</span></div>
          <div class="meta-line"><span class="meta-label">To:</span> <span class="meta-val">${esc(meta.to)}</span></div>
          <div class="meta-line"><span class="meta-label">Period:</span> <span class="meta-val">${esc(meta.period)}</span></div>
        </div>
      </div>
      <table class="statement-table">
        <thead>
          <tr>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          ${totalsRow}
        </tbody>
      </table>
    </div>
    <footer class="statement-footer">
      <div class="footer-left"><a href="${esc(meta.appUrl)}" target="_blank">${esc(meta.appUrl)}</a></div>
      <div class="footer-right">Page 1 of 1</div>
    </footer>
  </div>
</body>
</html>`;
}


export async function saveWithPicker(name, mime, data) {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const ext = name.includes('.') ? '.' + name.split('.').pop() : '.json';
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{
          description: 'Hisaab Backup File',
          accept: { [mime || 'application/json']: [ext] }
        }]
      });
      const writable = await handle.createWritable();
      const content = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/json' });
      await writable.write(content);
      await writable.close();
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false; // user cancelled save picker
    }
  }
  download(name, mime, data);
  return true;
}

export function download(name, mime, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export function printHTML(html) {
  try {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden';
    document.body.append(f);
    f.contentDocument.open();
    f.contentDocument.write(html);
    f.contentDocument.close();
    setTimeout(() => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch {
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); w.print(); }
      }
      setTimeout(() => f.remove(), 3000);
    }, 400);
  } catch {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }
}

export function toImage(m, tpl = 'clean') {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f9e7a';
  const T = { clean: { bg: '#fff', ink: '#1c2430', mut: '#6b7785', line: '#e6eaee', font: 'system-ui,sans-serif' },
    ledger: { bg: '#f6efdd', ink: '#2b2418', mut: '#7a6c52', line: '#d8cdb0', font: 'Georgia,serif' },
    glass: { bg: null, ink: '#17202b', mut: '#51606f', line: 'rgba(255,255,255,.8)', font: 'system-ui,sans-serif' } }[tpl];
  const items = []; m.groups.forEach(g => { if (g.title) items.push({ h: g.title }); g.rows.forEach(r => items.push({ r })); });
  const shown = items.slice(0, 60), W = 1080, P = 56, RH = 46, H = P * 2 + 170 + (shown.length + 1) * RH + (m.showTotals ? 110 : 0) + (items.length > 60 ? 40 : 0);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  if (T.bg) { x.fillStyle = T.bg; x.fillRect(0, 0, W, H); } else {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#cfe9e0'); g.addColorStop(.6, '#cdd6f7'); g.addColorStop(1, '#f7d9cf'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.roundRect(24, 24, W - 48, H - 48, 36); x.fill();
  }
  x.textBaseline = 'middle'; x.fillStyle = T.ink; x.font = `700 44px ${T.font}`; x.fillText(m.title, P, P + 24);
  x.fillStyle = T.mut; x.font = `400 24px ${T.font}`; x.fillText(m.subtitle.slice(0, 80), P, P + 74);
  const wt = { Date: 1.1, Fund: 1.3, Category: 1.3, Party: 1.3, Type: 1, Amount: 1.2, Comment: 2.2, Balance: 1.2, 'Entry ID': 1, 'Last edited': 1.8 }, sum = m.cols.reduce((a, k) => a + (wt[k] || 1), 0);
  let acc = 0; const col = m.cols.map(k => { const w = ((W - P * 2) * (wt[k] || 1)) / sum, o = { x: P + acc, w }; acc += w; return o; });
  const put = (t, i, y) => { let s = String(t); while (x.measureText(s).width > col[i].w - 14 && s.length > 1) s = s.slice(0, -2) + '…'; x.textAlign = m.right[i] ? 'right' : 'left'; x.fillText(s, m.right[i] ? col[i].x + col[i].w - 8 : col[i].x, y); };
  let y = P + 140; x.font = `700 22px ${T.font}`; x.fillStyle = accent; m.cols.forEach((k, i) => put(k, i, y));
  x.strokeStyle = T.line; x.lineWidth = 2; x.beginPath(); x.moveTo(P, y + 24); x.lineTo(W - P, y + 24); x.stroke(); y += RH;
  x.font = `400 22px ${T.font}`;
  for (const it of shown) {
    x.fillStyle = T.ink;
    if (it.h) { x.font = `700 22px ${T.font}`; x.textAlign = 'left'; x.fillText(it.h, P, y); x.font = `400 22px ${T.font}`; } else it.r.forEach((v, i) => put(v, i, y));
    y += RH;
  }
  x.textAlign = 'left'; if (items.length > 60) { x.fillStyle = T.mut; x.fillText(`+ ${items.length - 60} more entries (use PDF or CSV for the full list)`, P, y); y += 40; }
  if (m.showTotals) { x.fillStyle = accent; x.font = `700 28px ${T.font}`; x.fillText(`Received ${fmt(m.totals.income)}   Spent ${fmt(m.totals.expense)}   Net ${fmt(m.totals.net)}`, P, y + 40); }
  return new Promise(r => c.toBlob(r, 'image/png'));
}
