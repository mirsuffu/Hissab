// Logs: what the app itself did (starts, sync, imports/exports, setting changes, errors). Stays on this device.
import { readLogs, clearLogs, logger } from '../core/log.js';
import { esc, toast, confirmModal } from '../ui.js';

let level = 'all';

export async function render(root) {
  root.innerHTML = '<header class="top"><h1>Logs</h1></header><p class="muted">Loading…</p>';
  const all = (await readLogs()).sort((a, b) => b.ts - a.ts), rows = all.filter(l => level === 'all' || l.level === level).slice(0, 300);
  root.innerHTML = `
    <header class="top"><div><a class="muted" href="javascript:history.length>1?history.back():location.hash='#/home'" style="cursor:pointer">‹ Back</a><h1>Logs</h1><p class="muted">App events on this device. Last 2,000 are kept.</p></div></header>
    <div class="row"><label class="field"><select data-l aria-label="Filter by level">${['all', 'info', 'warn', 'error'].map(l => `<option value="${l}" ${l === level ? 'selected' : ''}>${l === 'all' ? 'All levels' : l}</option>`).join('')}</select></label>
      <button class="btn" data-export>Export logs</button><button class="btn danger" data-clear>Clear logs</button></div>
    <div class="rows">${rows.map(l => `<div class="row-item" style="cursor:default"><span>${esc(l.msg)}<small>${new Date(l.ts).toLocaleString()}${l.ctx ? ' · ' + esc(l.ctx) : ''}</small></span><span class="amt ${l.level === 'error' ? 'neg' : 'muted'}">${l.level}</span></div>`).join('') || '<div class="empty glass">No logs.</div>'}</div>`;
  root.onchange = e => { if (e.target.matches('[data-l]')) { level = e.target.value; render(root); } };
  root.onclick = async e => {
    if (e.target.closest('[data-export]')) {
      const text = all.map(l => `${new Date(l.ts).toISOString()} [${l.level}] ${l.msg} ${l.ctx}`).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'hisaab-logs.txt'; a.click();
    } else if (e.target.closest('[data-clear]')) {
      const ok = await confirmModal({
        title: 'Clear Device Logs?',
        message: 'Clear all logs on this device? The audit trail is not affected.',
        confirmText: 'Clear Logs',
        danger: true
      });
      if (!ok) return;
      await clearLogs(); await logger.info('Logs cleared by user'); toast('Device event logs vaporized! Clean slate 🧹✨'); render(root);
    }
  };
}
