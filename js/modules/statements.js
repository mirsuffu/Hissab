import { store } from '../core/store.js';
import { today, fmt } from '../core/models.js';
import { FIELDS, DEFAULT_FIELDS, buildModel, toCSV, toText, toHTML, toImage, download, printHTML } from '../core/export.js';
import { esc, toast, promptModal } from '../ui.js';

const KEY = 'hisaab.export', PKEY = 'hisaab.presets';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
let O = { title: 'Statement', period: 'month', date: today(), month: today().slice(0, 7), year: today().slice(0, 4), from: '', to: '', fundId: '', categoryId: '', partyId: '', type: 'all', fields: DEFAULT_FIELDS, groupBy: 'none', sort: 'asc', totals: true, template: 'clean', ...load(KEY, {}) };
let applied = '';
const sel = (k, opts, v) => `<label class="field"><span>${k[1]}</span><select data-k="${k[0]}">${opts.map(([val, t]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const inp = (k, label, type, v) => `<label class="field"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(v)}"></label>`;

export function render(root, arg) {
  if (!arg) applied = ''; else if (arg !== applied) { O.fundId = arg; applied = arg; }
  const L = store.live(), m = buildModel(L, O), presets = load(PKEY, []);
  const list = (items, all) => [['', all], ...items.map(i => [i.id, i.name + (i.deleted ? ' (deleted)' : '')])];
  root.innerHTML = `
    <header class="top">
      <div>
        ${arg ? `<a class="muted" href="#/funds/${esc(arg)}" style="cursor:pointer;font-size:.82rem;display:inline-block;margin-bottom:4px">‹ Back to fund</a>` : ''}
        <h1>Statements</h1>
      </div>
    </header>
    <section class="card glass form">
      ${inp('title', 'Title', 'text', O.title)}
      ${sel(['period', 'Period'], [['day', 'Daily'], ['month', 'Monthly'], ['year', 'Yearly'], ['range', 'Custom range'], ['all', 'All time']], O.period)}
      ${O.period === 'day' ? inp('date', 'Date', 'date', O.date) : ''}${O.period === 'month' ? inp('month', 'Month', 'month', O.month) : ''}${O.period === 'year' ? inp('year', 'Year', 'number', O.year) : ''}
      ${O.period === 'range' ? inp('from', 'From', 'date', O.from) + inp('to', 'To', 'date', O.to) : ''}
      ${sel(['fundId', 'Fund'], list(L.allFunds, 'All funds'), O.fundId)}${sel(['categoryId', 'Category'], list(L.allCategories, 'All categories'), O.categoryId)}${sel(['partyId', 'Party'], list(L.allParties, 'All parties'), O.partyId)}
      ${sel(['type', 'Entries'], [['all', 'Received and spent'], ['in', 'Received only'], ['out', 'Spent only']], O.type)}
    </section>
    <section class="card glass form"><h2>Fields to include</h2>
      <div class="row">${Object.entries(FIELDS).map(([k, v]) => `<label class="pill"><input type="checkbox" data-f="${k}" ${O.fields.includes(k) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      ${sel(['groupBy', 'Group by'], [['none', 'No grouping'], ['date', 'Date'], ['category', 'Category'], ['party', 'Party'], ['fund', 'Fund']], O.groupBy)}
      ${sel(['sort', 'Order'], [['asc', 'Oldest first'], ['desc', 'Newest first']], O.sort)}
      ${sel(['template', 'Design (PDF, Word, image)'], [['clean', 'Clean'], ['ledger', 'Ledger'], ['glass', 'Glass']], O.template)}
      <label class="pill"><input type="checkbox" data-t ${O.totals ? 'checked' : ''}><span>Show totals</span></label>
    </section>
    <section class="card glass form"><h2>Export</h2>
      <p class="muted">${m.totals.count} entries · Received ${fmt(m.totals.income)} · Spent ${fmt(m.totals.expense)}</p>
      <div class="row">${[['pdf', 'PDF'], ['xls', 'Excel'], ['doc', 'Word'], ['csv', 'CSV'], ['txt', 'TXT'], ['png', 'Image'], ['copy', 'Copy text']].map(([k, v]) => `<button class="btn" data-out="${k}">${v}</button>`).join('')}</div>
      <div class="row"><button class="btn" data-save>Save as preset</button>${presets.map((p, i) => `<span class="row"><button class="btn" data-load="${i}">${esc(p.name)}</button><button class="btn danger" data-del="${i}" aria-label="Delete preset">×</button></span>`).join('')}</div>
    </section>`;
  const keep = () => localStorage.setItem(KEY, JSON.stringify(O));
  root.onchange = e => {
    const t = e.target;
    if (t.dataset.k) O[t.dataset.k] = t.value;
    else if (t.dataset.f) O.fields = Object.keys(FIELDS).filter(k => (k === t.dataset.f ? t.checked : O.fields.includes(k)));
    else if ('t' in t.dataset) O.totals = t.checked;
    else return;
    keep(); render(root, arg);
  };
  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const model = buildModel(store.live(), O), name = `${O.title}-${model.subtitle.split(' · ')[0]}`.replace(/[^\w.-]+/g, '_');
    if (b.dataset.out) {
      const k = b.dataset.out;
      if (!model.totals.count) return toast('No entries match these filters! Your criteria yielded zero coins 🪙🏜️');
      if (k === 'csv') download(name + '.csv', 'text/csv', toCSV(model));
      else if (k === 'txt') download(name + '.txt', 'text/plain', toText(model));
      else if (k === 'xls') download(name + '.xls', 'application/vnd.ms-excel', toHTML(model, 'clean'));
      else if (k === 'doc') download(name + '.doc', 'application/msword', toHTML(model, O.template));
      else if (k === 'pdf') printHTML(toHTML(model, O.template));
      else if (k === 'png') download(name + '.png', 'image/png', await toImage(model, O.template));
      else if (k === 'copy') { await navigator.clipboard?.writeText(toText(model)); toast('Statement copied to clipboard! Ready to paste & ponder 📋🧐'); }
    } else if ('save' in b.dataset) {
      const n = await promptModal({
        title: 'Save Statement Preset',
        message: 'Enter a name for this custom statement filter preset:',
        placeholder: 'e.g. Monthly Tax Report'
      });
      if (!n) return;
      localStorage.setItem(PKEY, JSON.stringify([...presets.filter(p => p.name !== n), { name: n, o: O }])); render(root, arg);
    } else if (b.dataset.load) { O = { ...O, ...presets[b.dataset.load].o }; keep(); render(root, arg); }
    else if (b.dataset.del) { localStorage.setItem(PKEY, JSON.stringify(presets.filter((_, i) => i !== Number(b.dataset.del)))); render(root, arg); }
  };
}
