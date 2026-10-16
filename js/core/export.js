// Statement engine: filter -> model -> any output (CSV, text, HTML for PDF/Excel/Word, PNG image).
import { fmt } from './models.js';
import { fundSigned } from './calc.js';

export const FIELDS = { date: 'Date', fund: 'Fund', category: 'Category', party: 'Party', type: 'Type', amount: 'Amount', comment: 'Comment', balance: 'Balance', id: 'Entry ID', edited: 'Last edited' };
export const DEFAULT_FIELDS = ['date', 'category', 'party', 'comment', 'amount'];

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
  const cell = {
    date: r => r.t.date, fund: r => fund[r.t.fundId] || '', category: r => r.t.potId ? 'Pot Transfer' : (cat[r.t.categoryId] || 'General'), party: r => party[r.t.partyId] || '',
    type: r => {
      if (r.t.potId) return r.t.type === 'in' ? 'To Pot' : 'From Pot';
      return r.t.type === 'in' ? 'Received' : 'Spent';
    },
    amount: r => {
      const isFundInflow = r.t.potId ? r.t.type === 'out' : r.t.type === 'in';
      return (isFundInflow ? '+' : '-') + fmt(r.t.amount);
    },
    comment: r => r.t.note || '',
    balance: r => fmt(r.bal), id: r => r.t.id.slice(0, 8), edited: r => new Date(r.t.updatedAt || r.t.createdAt).toLocaleString(),
  };
  const cols = o.fields.filter(f => cell[f]);
  const keyOf = { date: cell.date, category: cell.category, party: r => cell.party(r) || 'No party', fund: cell.fund }[o.groupBy];
  const buckets = new Map();
  for (const r of rows) { const k = keyOf ? keyOf(r) : ''; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
  const month = o.month && new Date(o.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const label = { day: o.date, month, year: o.year, range: `${o.from || '…'} to ${o.to || '…'}`, all: 'All time' }[o.period];
  const extra = [o.fundId && `Fund: ${fund[o.fundId]}`, o.categoryId && `Category: ${cat[o.categoryId]}`, o.partyId && `Party: ${party[o.partyId]}`, o.type !== 'all' && (o.type === 'in' ? 'Received only' : 'Spent only')].filter(Boolean);
  return {
    title: o.title || 'Statement', subtitle: [label, ...extra].join(' · '), cols: cols.map(c => FIELDS[c]), right: cols.map(c => c === 'amount' || c === 'balance'),
    groups: [...buckets].map(([title, rs]) => ({ title, rows: rs.map(r => cols.map(c => cell[c](r))) })),
    totals: { income, expense, net: income - expense, count: rows.length }, showTotals: o.totals,
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
const CSS = {
  clean: 'body{font:14px system-ui,sans-serif;color:#1c2430;margin:32px}th{background:#2f9e7a;color:#fff}td,th{padding:8px 10px;border-bottom:1px solid #e6eaee;text-align:left}',
  ledger: 'body{font:14px Georgia,serif;color:#2b2418;background:#f6efdd;margin:32px}th{border-bottom:2px solid #2b2418}td,th{padding:8px 10px;border-bottom:1px solid #d8cdb0;text-align:left}',
  glass: 'body{font:14px system-ui,sans-serif;color:#17202b;margin:32px;background:linear-gradient(135deg,#cfe9e0,#cdd6f7 60%,#f7d9cf)}table{background:rgba(255,255,255,.6)}th{background:rgba(255,255,255,.7)}td,th{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.8);text-align:left}',
};
export function toHTML(m, tpl = 'clean') {
  const body = m.groups.map(g => (g.title ? `<tr><th colspan="${m.cols.length}">${esc(g.title)}</th></tr>` : '') +
    g.rows.map(r => `<tr>${r.map((c, i) => `<td${m.right[i] ? ' style="text-align:right"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(m.title)}</title><style>${CSS[tpl]}table{border-collapse:collapse;width:100%;border-radius:12px}h1{margin:0}p{color:#6b7785}</style>
  <h1>${esc(m.title)}</h1><p>${esc(m.subtitle)}</p><table><thead><tr>${m.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
  ${m.showTotals ? `<p><b>Received ${fmt(m.totals.income)} · Spent ${fmt(m.totals.expense)} · Net ${fmt(m.totals.net)}</b> (${m.totals.count} entries)</p>` : ''}`;
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
