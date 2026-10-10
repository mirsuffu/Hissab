import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { prefs, setPref, resetPrefs } from '../core/prefs.js';
import * as cloud from '../core/cloud.js';
import * as lock from '../core/lock.js';
import { encrypt, decrypt, isEncrypted } from '../core/crypto.js';
import { download } from '../core/export.js';
import { logger } from '../core/log.js';
import { getAiConfig, saveAiConfig } from '../core/ai.js';
import { esc, toast, openSheet, closeSheet } from '../ui.js';

const range = (k, label, min, max, step = 1, detailed = true) =>
  `<label class="field${detailed ? ' d-only' : ''}"><span>${label}</span><input type="range" data-pref="${k}" min="${min}" max="${max}" step="${step}" value="${prefs()[k]}"></label>`;
const link = (href, title, sub) => `<a class="row-item" href="${href}">${title}<small>${sub}</small></a>`;
const pill = (attr, on, label) => `<label class="pill"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><span>${label}</span></label>`;

function account() {
  const c = cloud.state();
  if (!c.configured) return '<p class="muted">Cloud features are off. Add your Firebase config in js/firebase-config.js to enable sign-in, backup sync and chat.</p>';
  if (!c.ready) return '<p class="muted">Connecting…</p>';
  if (!c.user) return `<div><p class="muted" style="margin-bottom:8px">Running as <b>Guest (Local Account)</b>. Data is stored privately on this device.</p>
    <label class="field" style="margin-bottom:12px">
      <span>Periodic Sync Interval (When Connected)</span>
      <select data-sync-interval>
        <option value="0" ${sync.interval() === 0 ? 'selected' : ''}>Real-time (Immediate)</option>
        <option value="60" ${sync.interval() === 60 ? 'selected' : ''}>Every 1 minute</option>
        <option value="120" ${sync.interval() === 120 ? 'selected' : ''}>Every 2 minutes</option>
        <option value="300" ${sync.interval() === 300 ? 'selected' : ''}>Every 5 minutes</option>
        <option value="600" ${sync.interval() === 600 ? 'selected' : ''}>Every 10 minutes</option>
      </select>
    </label>
    <button class="btn primary" data-signin>Sign in with Google</button></div>`;
  return `<p>${esc(c.profile?.name || c.user.displayName || c.user.email)}${c.profile ? ` <span class="muted">@${esc(c.profile.handle)}</span>` : ''}</p>
    ${pill('data-sync', localStorage.getItem('hisaab.syncOn') === '1', 'Back up and sync my data')}
    <label class="field" style="margin-top:8px">
      <span>Sync Interval</span>
      <select data-sync-interval>
        <option value="0" ${sync.interval() === 0 ? 'selected' : ''}>Real-time (Immediate)</option>
        <option value="60" ${sync.interval() === 60 ? 'selected' : ''}>Every 1 minute</option>
        <option value="120" ${sync.interval() === 120 ? 'selected' : ''}>Every 2 minutes</option>
        <option value="300" ${sync.interval() === 300 ? 'selected' : ''}>Every 5 minutes</option>
        <option value="600" ${sync.interval() === 600 ? 'selected' : ''}>Every 10 minutes</option>
      </select>
    </label>
    ${c.profile ? pill('data-disc', c.profile.discoverable, 'Let people find me by name') : '<a class="btn" href="#/chat">Choose your chat ID</a>'}
    <div><button class="btn" data-signout>Disconnect Google (Switch to Guest)</button></div>`;
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
      <label class="field"><span>Font size (${p.fontSize || 15}px)</span><input type="range" data-pref="fontSize" min="12" max="20" step="1" value="${p.fontSize || 15}"></label>
      ${range('hue', 'Accent colour', 0, 360, 1, false)}${range('radius', 'Roundness', 6, 36)}${range('depth', 'Depth (soft shadows)', 2, 18)}${range('blur', 'Glass blur', 0, 36)}${range('density', 'Spacing', 0.75, 1.4, 0.05)}
      <div><button class="btn" data-reset>Reset appearance</button></div>
    </section>
    <section class="card glass form"><h2>Manage</h2>
      <div class="rows">${link('#/funds', 'Funds', 'Add, edit, delete, restore')}${link('#/manage/categories', 'Categories', 'Add, rename, delete, restore')}${link('#/manage/parties', 'Parties', 'Add, rename, delete, restore')}${link('#/recurring', 'Recurring entries', 'Rent, subscriptions, allowances')}</div>
    </section>
    <section class="card glass form"><h2>Alerts</h2>
      ${pill('data-notify', localStorage.getItem('hisaab.notify') === '1' && globalThis.Notification?.permission === 'granted', 'Notify me about budgets and unusual spends')}
      <p class="muted">Alerts always show on Home. Notifications appear while the app is open.</p>
    </section>
    <section class="card glass form"><h2>Security</h2>
      <p class="muted">${lock.hasPin() ? 'PIN lock is active.' : 'PIN lock is off.'} Protects app access on unattended devices.</p>
      <div class="row"><button class="btn" data-setpin>${lock.hasPin() ? 'Change PIN' : 'Set PIN'}</button>${lock.hasPin() ? '<button class="btn danger" data-clearpin>Remove PIN</button>' : ''}</div>
      ${lock.hasPin() ? `<label class="field"><span>Lock after leaving the app for</span><select data-lockmin>${[0, 1, 5, 15].map(m => `<option value="${m}" ${lock.minutes() === m ? 'selected' : ''}>${m ? m + ' min' : 'Immediately'}</option>`).join('')}</select></label>` : ''}
    </section>
    <section class="card glass form"><h2>Account & Cloud</h2>${account()}</section>
    <section class="card glass form"><h2>People & Family Profiles</h2>
      <p class="muted">Each person keeps separate funds. Active: <b>${esc(profile.name)}</b></p>
      <div class="rows">
        ${profiles.map(x => `
          <div class="row-item" style="display:flex;justify-content:space-between;align-items:center">
            <button style="background:none;border:0;cursor:pointer;flex:1;text-align:left" data-profile="${x.id}">
              <span>${esc(x.name)}</span>
              <small style="color:var(--ink-2)">${x.id === profile.id ? 'Active' : 'Tap to switch'}</small>
            </button>
            ${x.id !== profiles[0].id ? `<button class="btn-micro" style="color:var(--neg)" data-del-profile="${x.id}" title="Delete profile">Delete</button>` : '<span class="chip">Owner</span>'}
          </div>
        `).join('')}
      </div>
      <form id="pf" class="row"><label class="field" style="flex:1"><span>Add person</span><input name="name" required autocomplete="off"></label><button class="btn">Add</button></form>
    </section>
    <section class="card glass form" id="ai-settings">
      <h2>AI Financial Co-Pilot</h2>
      <p class="muted">Built-in local intelligence persona ("Munimji") works completely offline at zero cost. Custom API providers are also supported.</p>
      <label class="pill">
        <input type="checkbox" data-ai-enabled ${aiCfg.enabled ? 'checked' : ''}>
        <span>Enable AI Financial Assistant</span>
      </label>
      <div id="ai-body" ${aiCfg.enabled ? '' : 'hidden'} style="display:grid;gap:12px;margin-top:6px">
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
        <label class="field">
          <span>Custom System Prompt (Optional)</span>
          <textarea data-ai-sysprompt rows="3" placeholder="Add specific accounting rules or personal instructions for the AI assistant…">${esc(aiCfg.systemPrompt || '')}</textarea>
        </label>
        <div><button type="button" class="btn primary" data-ai-save>Save AI Settings</button></div>
      </div>
    </section>
    <section class="card glass form"><h2>Records & Data</h2>
      <div class="rows">${link('#/statements', 'Statements', 'Export by day, month, fund, category, party…')}${link('#/audit', 'Audit trail', 'Every change to your data')}${link('#/logs', 'Logs', 'What the app did on this device')}</div>
      <p class="muted">Cloud sync: ${sync.status()}</p>
      <div class="row">
        <button class="btn" data-export>Export backup</button>
        <button class="btn" data-export-enc>Encrypted backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
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
      else if (t.matches('[data-sync-interval]')) { sync.setInterval(Number(t.value)); sync.schedule((k, d) => store.applyRemote(k, d, false)); toast('Sync interval saved'); }
      else if (t.matches('[data-disc]')) { await cloud.updateProfile({ discoverable: t.checked }); toast(t.checked ? 'People can find you by name' : 'Only your ID finds you now'); }
      else if (t.matches('[data-ai-enabled]')) {
        saveAiConfig({ enabled: t.checked });
        root.querySelector('#ai-body').hidden = !t.checked;
        const fabAi = document.querySelector('#fab-ai');
        if (fabAi) fabAi.hidden = !t.checked;
        toast(t.checked ? 'AI assistant enabled' : 'AI assistant disabled');
      }
      else if (t.matches('[data-notify]')) {
        if (t.checked && globalThis.Notification && (await Notification.requestPermission()) === 'granted') localStorage.setItem('hisaab.notify', '1');
        else { localStorage.setItem('hisaab.notify', '0'); if (t.checked) toast('Notifications are blocked in your browser settings'); }
        render(root);
      } else if (t.matches('[data-import]')) {
        let text = await t.files[0].text();
        if (isEncrypted(text)) {
          openSheet(`
            <h2>Import Encrypted Backup</h2>
            <form id="import-enc-form" class="form">
              <label class="field"><span>Backup Passphrase</span><input type="password" name="pass" required placeholder="Enter passphrase"></label>
              <button class="btn primary">Decrypt & Restore</button>
            </form>
          `, el => {
            el.querySelector('#import-enc-form').onsubmit = async evt => {
              evt.preventDefault();
              const pass = evt.target.pass.value;
              try {
                const dec = await decrypt(text, pass);
                await store.importAll(dec);
                closeSheet();
                toast('Backup restored successfully');
                render(root);
              } catch {
                toast('Wrong passphrase or corrupted backup');
              }
            };
          });
          return;
        }
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
      const delPr = t.closest('[data-del-profile]');
      if (delPr) {
        const id = delPr.dataset.delProfile;
        const pTarget = profiles.find(x => x.id === id);
        if (!confirm(`Delete profile "${pTarget?.name || 'this person'}"? Past records will remain in the audit trail.`)) return;
        await store.deleteProfile(id);
        toast('Profile deleted');
        render(root);
        return;
      }
      if (t.closest('[data-export]')) download(`hisaab-backup-${date()}.json`, 'application/json', store.exportAll());
      else if (t.closest('[data-export-enc]')) {
        openSheet(`
          <h2>Encrypted Backup</h2>
          <p class="muted">Choose a passphrase (min 8 characters). You will need it to restore this file.</p>
          <form id="enc-form" class="form">
            <label class="field"><span>Passphrase</span><input type="password" name="pass" required minlength="8" placeholder="Passphrase (min 8 chars)"></label>
            <label class="field"><span>Confirm Passphrase</span><input type="password" name="confirm" required minlength="8" placeholder="Type again"></label>
            <button class="btn primary">Download Encrypted Backup</button>
          </form>
        `, el => {
          el.querySelector('#enc-form').onsubmit = async evt => {
            evt.preventDefault();
            const pass = evt.target.pass.value;
            const conf = evt.target.confirm.value;
            if (pass !== conf) return toast('Passphrases did not match');
            const encData = await encrypt(store.exportAll(), pass);
            download(`hisaab-backup-${date()}.enc.json`, 'application/json', encData);
            closeSheet();
            toast('Encrypted backup saved');
          };
        });
      }
      else if (t.closest('[data-signin]')) await cloud.signIn();
      else if (t.closest('[data-signout]')) { await cloud.signOut(); render(root); }
      else if (t.closest('[data-setpin]')) {
        openSheet(`
          <h2>${lock.hasPin() ? 'Change PIN' : 'Set PIN'}</h2>
          <p class="muted">Enter a 4–8 digit PIN to protect unattended access.</p>
          <form id="pin-setup-form" class="form">
            ${lock.hasPin() ? '<label class="field"><span>Current PIN</span><input type="password" inputmode="numeric" name="cur" required maxlength="8" placeholder="Current PIN"></label>' : ''}
            <label class="field"><span>New PIN (4–8 digits)</span><input type="password" inputmode="numeric" name="pin" required minlength="4" maxlength="8" placeholder="New PIN"></label>
            <label class="field"><span>Confirm New PIN</span><input type="password" inputmode="numeric" name="confirm" required minlength="4" maxlength="8" placeholder="Confirm PIN"></label>
            <button class="btn primary">Save PIN</button>
          </form>
        `, el => {
          el.querySelector('#pin-setup-form').onsubmit = async evt => {
            evt.preventDefault();
            const f = evt.target;
            if (lock.hasPin()) {
              if (!(await lock.verify(f.cur.value))) return toast('Wrong current PIN');
            }
            const n = f.pin.value;
            if (!/^\d{4,8}$/.test(n)) return toast('PIN must be 4–8 digits');
            if (f.confirm.value !== n) return toast('PINs did not match');
            await lock.setPin(n, lock.minutes());
            logger.info('PIN set');
            closeSheet();
            toast('PIN saved');
            render(root);
          };
        });
      } else if (t.closest('[data-clearpin]')) {
        openSheet(`
          <h2>Remove PIN</h2>
          <form id="pin-clear-form" class="form">
            <label class="field"><span>Enter current PIN to remove</span><input type="password" inputmode="numeric" name="cur" required maxlength="8" placeholder="Current PIN"></label>
            <button class="btn danger">Remove PIN</button>
          </form>
        `, el => {
          el.querySelector('#pin-clear-form').onsubmit = async evt => {
            evt.preventDefault();
            if (!(await lock.verify(evt.target.cur.value))) return toast('Wrong PIN');
            lock.clearPin();
            logger.info('PIN removed');
            closeSheet();
            toast('PIN removed');
            render(root);
          };
        });
      } else if (t.closest('[data-ai-save]')) {
        const enabled = root.querySelector('[data-ai-enabled]')?.checked ?? true;
        const prov = root.querySelector('[data-ai-provider]')?.value || 'local';
        const key = root.querySelector('[data-ai-key]')?.value.trim() || '';
        const model = root.querySelector('[data-ai-model]')?.value.trim() || '';
        const ep = root.querySelector('[data-ai-endpoint]')?.value.trim() || '';
        const sys = root.querySelector('[data-ai-sysprompt]')?.value.trim() || '';
        saveAiConfig({ enabled, provider: prov, apiKey: key, model, endpoint: ep, systemPrompt: sys });
        const fabAi = document.querySelector('#fab-ai');
        if (fabAi) fabAi.hidden = !enabled;
        toast('AI configuration saved');
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };
  root.querySelector('#pf').onsubmit = async e => { e.preventDefault(); await store.addProfile(new FormData(e.target).get('name').trim()); toast('Person added'); };
}

