// Logs = what the APP did (starts, sync results, imports, setting changes, errors). Device-local, prunable.
// Audit trail (store.js) = what changed in your MONEY DATA. Append-only, synced, never editable.
import * as db from './db.js';
const MAX = 2000;
let n = 0;
async function write(level, msg, ctx) {
  try { await db.put('logs', { id: `${Date.now()}-${n++}`, ts: Date.now(), level, msg, ctx: ctx ? JSON.stringify(ctx).slice(0, 400) : '' }); } catch { /* logging must never break the app */ }
}
export const logger = { info: (m, c) => write('info', m, c), warn: (m, c) => write('warn', m, c), error: (m, c) => write('error', m, c) };
export const readLogs = () => db.all('logs');
export const clearLogs = () => db.clear('logs');
export async function pruneLogs() {
  const rows = (await db.all('logs')).sort((a, b) => a.ts - b.ts);
  for (const r of rows.slice(0, Math.max(0, rows.length - MAX))) await db.del('logs', r.id);
}
