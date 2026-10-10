import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { prefs, setPref, resetPrefs } from '../core/prefs.js';
import * as cloud from '../core/cloud.js';
import * as lock from '../core/lock.js';
import { encrypt, decrypt, isEncrypted } from '../core/crypto.js';
import { download } from '../core/export.js';
import { logger } from '../core/log.js';
import { getAiConfig, saveAiConfig } from '../core/ai.js';
import { esc, toast } from '../ui.js';

const range = (k, label, min, max, step = 1, detailed = true) =>
  `<label class="field${detailed ? ' d-only' : ''}"><span>${label}</span><input type="range" data-pref="${k}" min="${min}" max="${max}" step="${step}" value="${prefs()[k]}"></label>`;
const link = (href, title, sub) => `<a class="row-item" href="${href}">${title}<small>${sub}</small></a>`;
const pill = (attr, on, label) => `<label class="pill"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><span>${label}</span></label>`;

function account() {
  const c = cloud.state();
  if (!c.configured) return '<p class="muted">Cloud features are off. Add your Firebase config in js/firebase-config.js to enable sign-in, backup sync and chat.</p>';
  if (!c.ready) return '<p class="muted">Connecting…</p>';
  if (!c.user) return '<div><button class="btn primary" data-signin>Sign in with Google</button></div>';
  return `<p>${esc(c.profile?.name || c.user.displayName || c.user.email)}${c.profile ? ` <span class="muted">@${esc(c.profile.handle)}</span>` : ''}</p>
    ${pill('data-sync', localStorage.getItem('hisaab.syncOn') === '1', 'Back up and sync my data')}
    ${c.profile ? pill('data-disc', c.profile.discoverable, 'Let people find me by name') : '<a class="btn" href="#/chat">Choose your chat ID</a>'}
    <div><button class="btn" data-signout>Sign out</button></div>`;
}

export function render(root) {
  const p = prefs(), { profiles, profile } = store.live(), aiCfg = getAiConfig();
  if (cloud.configured() && !cloud.state().ready) cloud.init().then(() => render(root)).catch(e => logger.warn('Cloud init failed', { error: String(e) }));
  root.innerHTML = `
    <header class="top"><h1>Settings</h1></header>
    <section class="card glass form"><h2>Mode</h2>
      <div class="seg">${['minimal', 'detailed'].map(m => `<label><input type="radio" name="mode" value="${m}" ${p.mode === m ? 'checked' : ''}><span>${m === 'minimal' ? 'Minimal' : 'Detailed'}</span></label>`).join('')}</div>
      <p class="muted">${p.mode === 'minimal' ? 'Fast logging: amount, fund, comment. Category defaults to General and the date to today.' : 'Adds categories, parties, dates, progress meters, forecasts, filters and full theme controls.'}</p>
    </section>
    <section class="card glass form"><h2>Appearance</h2>
      <div class="seg">${['auto', 'mist', 'ink'].map(t => `<label><input type="radio" name="theme" value="${t}" ${p.theme === t ? 'checked' : ''}><span>${{ auto: 'Auto', mist: 'Light', ink: 'Dark' }[t]}</span></label>`).join('')}</div>
      ${range('hue', 'Accent colour', 0, 360, 1, false)}${range('radius', 'Roundness', 6, 36)}${range('depth', 'Depth (soft shadows)', 2, 18)}${range('blur', 'Glass blur', 0, 36)}${range('density', 'Spacing', 0.75, 1.4, 0.05)}
      <div><button class="btn" data-reset>Reset appearance</button></div>
    </section>
    <section class="card glass form"><h2>Manage</h2>
      <div class="rows">${link('#/funds', 'Funds', 'Add, edit, delete, restore')}${link('#/manage/categories', 'Categories', 'Add, rename, delete, restore')}${link('#/manage/parties', 'Parties', 'Add, rename, delete, restore')}${link('#/recurring', 'Recurring entries', 'Rent, subscriptions, allowances')}</div>
    </section>
    <section class="card glass form"><h2>Alerts</h2>
      ${pill('data-notify', localStorage.getItem('hisaab.notify') === '1' && globalThis.Notification?.permission === 'granted', 'Notify me about budgets and unusual spends')}
      <p class="muted">Alerts always show on Home. Notifications appear while the app is open; background reminders come with the Android app.</p>
    </section>
    <section class="card glass form"><h2>Security</h2>
      <p class="muted">${lock.hasPin() ? 'PIN lock is on.' : 'PIN lock is off.'} It keeps casual snoopers out of an unattended device.</p>
      <div class="row"><button class="btn" data-setpin>${lock.hasPin() ? 'Change PIN' : 'Set PIN'}</button>${lock.hasPin() ? '<button class="btn danger" data-clearpin>Remove PIN</button>' : ''}</div>
      ${lock.hasPin() ? `<label class="field"><span>Lock after leaving the app for</span><select data-lockmin>${[0, 1, 5, 15].map(m => `<option value="${m}" ${lock.minutes() === m ? 'selected' : ''}>${m ? m + ' min' : 'Immediately'}</option>`).join('')}</select></label>` : ''}
    </section>
    <section class="card glass form"><h2>Account</h2>${account()}</section>
    <section class="card glass form"><h2>People</h2>
      <p class="muted">Each person keeps separate funds. Active: ${esc(profile.name)}</p>
      <div class="rows">${profiles.map(x => `<button class="row-item" data-profile="${x.id}">${esc(x.name)}<small>${x.id === profile.id ? 'Active' : 'Switch'}</small></button>`).join('')}</div>
      <form id="pf" class="row"><label class="field" style="flex:1"><span>Add person</span><input name="name" required></label><button class="btn">Add</button></form>
    </section>
    <section class="card glass form" id="ai-settings">
      <h2>AI Financial Co-Pilot</h2>
      <p class="muted">Set up your AI provider. Built-in local intelligence works completely offline at zero cost.</p>
      <label class="field">
        <span>Provider</span>
        <select data-ai-provider>
          <option value="local" ${aiCfg.provider === 'local' ? 'selected' : ''}>Built-in Local (Instant, Free, Offline)</option>
          <option value="gemini" ${aiCfg.provider === 'gemini' ? 'selected' : ''}>Google Gemini API</option>
          <option value="openrouter" ${aiCfg.provider === 'openrouter' ? 'selected' : ''}>OpenRouter API</option>
          <option value="custom" ${aiCfg.provider === 'custom' ? 'selected' : ''}>Custom OpenAI-compatible Endpoint</option>
        </select>
      </label>
      <div id="ai-fields" ${aiCfg.provider === 'local' ? 'hidden' : ''} style="display:grid;gap:12px">
        <label class="field">
          <span>API Key</span>
          <input type="password" data-ai-key placeholder="Enter API Key" value="${esc(aiCfg.apiKey || '')}">
        </label>
        <label class="field">
          <span>Model Name</span>
          <input type="text" data-ai-model placeholder="e.g. gemini-1.5-flash or google/gemini-2.0-flash-exp:free" value="${esc(aiCfg.model || '')}">
        </label>
        <label class="field" id="ai-endpoint-field" ${aiCfg.provider !== 'custom' ? 'hidden' : ''}>
          <span>Base URL</span>
          <input type="text" data-ai-endpoint placeholder="https://api.custom.com/v1" value="${esc(aiCfg.endpoint || '')}">
        </label>
      </div>
      <div><button type="button" class="btn primary" data-ai-save>Save AI Provider</button></div>
    </section>
    <section class="card glass form"><h2>Records & data</h2>
      <div class="rows">${link('#/statements', 'Statements', 'Export by day, month, fund, category, party…')}${link('#/audit', 'Audit trail', 'Every change to your data')}${link('#/logs', 'Logs', 'What the app did on this device')}</div>
      <p class="muted">Cloud sync: ${sync.status()}</p>
      <div class="row"><button class="btn" data-export>Export backup</button><button class="btn" data-export-enc>Encrypted backup</button><label class="btn">Import backup<input type="file" accept="application/json,.json" data-import hidden></label></div>
    </section>`;

  const date = () => new Date().toISOString().slice(0, 10);
  root.oninput = e => { const k = e.target.dataset.pref; if (k) setPref(k, Number(e.target.value)); };
  root.onchange = async e => {
    const t = e.target;
    try {
      if (t.name === 'theme') setPref('theme', t.value);
      else if (t.name === 'mode') { setPref('mode', t.value); render(root); }
      else if (t.matches('[data-lockmin]')) lock.setMinutes(Number(t.value));
      else if (t.matches('[data-sync]')) { localStorage.setItem('hisaab.syncOn', t.checked ? '1' : '0'); logger.info('Cloud sync toggled', { on: t.checked }); cloud.refresh(); }
      else if (t.matches('[data-disc]')) { await cloud.updateProfile({ discoverable: t.checked }); toast(t.checked ? 'People can find you by name' : 'Only your ID finds you now'); }
      else if (t.matches('[data-notify]')) {
        if (t.checked && globalThis.Notification && (await Notification.requestPermission()) === 'granted') localStorage.setItem('hisaab.notify', '1');
        else { localStorage.setItem('hisaab.notify', '0'); if (t.checked) toast('Notifications are blocked in your browser settings'); }
        render(root);
      } else if (t.matches('[data-import]')) {
        let text = await t.files[0].text();
        if (isEncrypted(text)) text = await decrypt(text, prompt('Backup passphrase') || '');
        await store.importAll(text); toast('Backup imported');
      } else if (t.matches('[data-ai-provider]')) {
        const val = t.value;
        const f = root.querySelector('#ai-fields'); if (f) f.hidden = val === 'local';
        const ep = root.querySelector('#ai-endpoint-field'); if (ep) ep.hidden = val !== 'custom';
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };
  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-reset]')) { resetPrefs(); render(root); }
      const pr = t.closest('[data-profile]'); if (pr) store.switchProfile(pr.dataset.profile);
      if (t.closest('[data-export]')) download(`hisaab-backup-${date()}.json`, 'application/json', store.exportAll());
      else if (t.closest('[data-export-enc]')) {
        const a = prompt('Choose a passphrase (min 8 characters). You will need it to restore.'); if (!a) return;
        if (a.length < 8) return toast('Use at least 8 characters');
        if (prompt('Type it again to confirm') !== a) return toast('Passphrases didn’t match');
        download(`hisaab-backup-${date()}.enc.json`, 'application/json', await encrypt(store.exportAll(), a)); toast('Encrypted backup saved');
      }
      else if (t.closest('[data-signin]')) await cloud.signIn();
      else if (t.closest('[data-signout]')) { await cloud.signOut(); render(root); }
      else if (t.closest('[data-setpin]')) {
        if (lock.hasPin() && !(await lock.verify(prompt('Current PIN') || ''))) return toast('Wrong PIN');
        const n = prompt('New PIN (4–8 digits)') || ''; if (!/^\d{4,8}$/.test(n)) return toast('PIN must be 4–8 digits');
        if (prompt('Type the PIN again') !== n) return toast('PINs didn’t match');
        await lock.setPin(n, lock.minutes()); logger.info('PIN set'); toast('PIN saved'); render(root);
      } else if (t.closest('[data-clearpin]')) {
        if (!(await lock.verify(prompt('Enter your PIN to remove it') || ''))) return toast('Wrong PIN');
        lock.clearPin(); logger.info('PIN removed'); render(root);
      } else if (t.closest('[data-ai-save]')) {
        const prov = root.querySelector('[data-ai-provider]')?.value || 'local';
        const key = root.querySelector('[data-ai-key]')?.value.trim() || '';
        const model = root.querySelector('[data-ai-model]')?.value.trim() || '';
        const ep = root.querySelector('[data-ai-endpoint]')?.value.trim() || '';
        saveAiConfig({ provider: prov, apiKey: key, model, endpoint: ep });
        toast('AI configuration saved');
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };
  root.querySelector('#pf').onsubmit = async e => { e.preventDefault(); await store.addProfile(new FormData(e.target).get('name').trim()); toast('Person added'); };
}
