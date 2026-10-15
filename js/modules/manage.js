// Full control over Categories and Parties: add, rename, delete (prospective), restore.
import { store } from '../core/store.js';
import { GENERAL_ID } from '../config.js';
import { esc, openSheet, closeSheet, toast, confirmModal } from '../ui.js';

const META = {
  categories: { title: 'Categories', one: 'category', hint: 'What an entry was for.' },
  parties:    { title: 'Parties',    one: 'party',    hint: 'People or places money comes from or goes to.' },
};
const tabs = kind => `<div class="row">${Object.entries(META).map(([k, v]) => `<a class="btn ${k === kind ? 'inset' : ''}" href="#/manage/${k}">${v.title}</a>`).join('')}<a class="btn" href="#/funds">Funds</a></div>`;

export function render(root, kind = 'categories') {
  const m = META[kind]; if (!m) { location.hash = '#/settings'; return; }
  const L = store.live(), items = kind === 'categories' ? L.allCategories : L.allParties;
  const by = (x, y) => x.name.localeCompare(y.name), live = items.filter(i => !i.deleted).sort(by), gone = items.filter(i => i.deleted).sort(by);
  root.innerHTML = `
    <header class="top"><div><a class="muted" href="javascript:history.length>1?history.back():location.hash='#/home'" style="cursor:pointer">‹ Back</a><h1>${m.title}</h1><p class="muted">${m.hint}</p></div><button class="btn primary" data-new>Add ${m.one}</button></header>
    ${tabs(kind)}
    <div class="rows">${live.map(i => `<button class="row-item" data-edit="${i.id}">${esc(i.name)}<small>Edit</small></button>`).join('') || `<div class="empty glass">No ${m.title.toLowerCase()} yet.</div>`}</div>
    ${gone.length ? `<section class="stack"><div><h2>Deleted</h2><p class="muted">Old entries still show these. Restore to use them again.</p></div>
      <div class="rows">${gone.map(i => `<button class="row-item" data-restore="${i.id}">${esc(i.name)}<small>Restore</small></button>`).join('')}</div></section>` : ''}`;
  root.onclick = async e => {
    const t = e.target;
    if (t.closest('[data-new]')) sheet(kind, null);
    else if (t.closest('[data-edit]')) sheet(kind, items.find(i => i.id === t.closest('[data-edit]').dataset.edit));
    else if (t.closest('[data-restore]')) {
      await store.restoreItem(kind, items.find(i => i.id === t.closest('[data-restore]').dataset.restore));
      toast(`Resurrected ${m.one}! Back in active circulation ♻️✨`);
    }
  };
}

function sheet(kind, item) {
  const m = META[kind], locked = item?.id === GENERAL_ID;
  openSheet(`
    <h2>${item ? 'Edit' : 'Add'} ${m.one}</h2>
    <form id="mf" class="form">
      <label class="field"><span>Name</span><input name="name" required autocomplete="off" value="${esc(item?.name || '')}"></label>
      ${item ? '<p class="muted">Renaming updates old entries too.</p>' : ''}
      <div class="row"><button class="btn primary">Save</button>${item && !locked ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}</div>
      ${locked ? '<p class="muted">General is the default category. You can rename it but not delete it.</p>' : ''}
    </form>`, el => {
    el.querySelector('#mf').onsubmit = async e => {
      e.preventDefault();
      const name = new FormData(e.target).get('name').trim(); if (!name) return;
      await store.saveItem(kind, item ? { ...item, name } : { name });
      closeSheet();
      toast(`${m.one.charAt(0).toUpperCase() + m.one.slice(1)} secured in the ledger! Order restored 🏷️✨`);
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: `Delete ${m.one}?`,
        message: `Delete this ${m.one}? Past entries keep it. It just won’t be offered for new entries.`,
        confirmText: 'Delete',
        danger: true
      });
      if (!ok) return;
      await store.removeItem(kind, item);
      closeSheet();
      toast(`${m.one.charAt(0).toUpperCase() + m.one.slice(1)} retired to the archives! 🗄️💨`);
    });
  });
}
