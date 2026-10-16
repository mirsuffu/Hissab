import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { prefs, setPref, resetPrefs } from '../core/prefs.js';
import { today } from '../core/models.js';
import * as cloud from '../core/cloud.js';
import * as lock from '../core/lock.js';
import { encrypt, decrypt, isEncrypted } from '../core/crypto.js';
import { download, saveWithPicker } from '../core/export.js';
import { logger } from '../core/log.js';
import { getAiConfig, saveAiConfig } from '../core/ai.js';
import { isBiometricEnabled, setBiometricEnabled, isBiometricAvailable, registerBiometric } from '../core/biometric.js';
import { playTick, triggerHaptic } from '../core/sound.js';
import { esc, toast, openSheet, closeSheet, toggleSwitch, confirmModal, promptModal } from '../ui.js';

const range = (k, label, min, max, step = 1, detailed = true) =>
  `<label class="field${detailed ? ' d-only' : ''}"><span>${label}</span><input type="range" data-pref="${k}" min="${min}" max="${max}" step="${step}" value="${prefs()[k]}"></label>`;
const link = (href, title, sub) => `<a class="row-item" href="${href}">${title}<small>${sub}</small></a>`;

export function render(root) {
  const p = prefs(), { profiles, profile, pots } = store.live(), aiCfg = getAiConfig();
  if (cloud.configured() && !cloud.state().ready) cloud.init().then(() => { if (location.hash.startsWith('#/settings')) render(root); }).catch(e => logger.warn('Cloud init failed', { error: String(e) }));

  const openIndexes = [];
  root.querySelectorAll('details.settings-acc').forEach((d, idx) => {
    if (d.open) openIndexes.push(idx);
  });

  root.innerHTML = `
    <header class="top"><h1>Settings</h1></header>

    <div class="settings-groups">

      <!-- 1. Appearance & Theme -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>🎨</span><span>Appearance & Theme</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          <label class="field"><span>Layout Mode</span></label>
          <div class="seg">${['minimal', 'detailed'].map(m => `<label><input type="radio" name="mode" value="${m}" ${p.mode === m ? 'checked' : ''}><span>${m === 'minimal' ? 'Minimal' : 'Detailed'}</span></label>`).join('')}</div>
          <p class="muted">${p.mode === 'minimal' ? 'Fast logging: amount, fund, comment. Category defaults to General and date to today.' : 'Adds categories, parties, progress meters, forecasts, filters and full theme controls.'}</p>

          <label class="field" style="margin-top:6px"><span>Theme</span></label>
          <div class="seg">${['auto', 'mist', 'ink'].map(t => `<label><input type="radio" name="theme" value="${t}" ${p.theme === t ? 'checked' : ''}><span>${{ auto: 'Auto', mist: 'Light', ink: 'Dark' }[t]}</span></label>`).join('')}</div>
          
          <label class="field"><span>Font size (${p.fontSize || 15}px)</span><input type="range" data-pref="fontSize" min="12" max="20" step="1" value="${p.fontSize || 15}"></label>
          ${range('hue', 'Accent colour', 0, 360, 1, false)}${range('radius', 'Roundness', 6, 36)}${range('depth', 'Depth (soft shadows)', 2, 18)}${range('blur', 'Glass blur', 0, 36)}${range('density', 'Spacing', 0.75, 1.4, 0.05)}
          <div><button class="btn" data-reset>Reset appearance</button></div>
        </div>
      </details>

      <!-- 2. Sound & Feedback -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>🔊</span><span>Sound & Feedback</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body">
          ${toggleSwitch('sound', p.sound !== false, 'Tactile Keyboard Click', 'Soft mechanical keyboard "tick" sound on valid buttons & controls', 'data-sound')}
          <label class="field" id="sound-vol-field" ${p.sound !== false ? '' : 'hidden'} style="margin-top:6px">
            <span id="lbl-sound-vol">Sound volume (${Math.round((p.soundVolume ?? 0.7) * 100)}%)</span>
            <input type="range" data-pref="soundVolume" min="0.1" max="1" step="0.05" value="${p.soundVolume ?? 0.7}">
          </label>
          ${toggleSwitch('haptic', p.haptics !== false, 'Haptic Vibration', 'Tactile haptic feedback on interaction (phones & tablets)', 'data-haptic')}
        </div>
      </details>

      <!-- 3. Security & App Lock -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>🔒</span><span>Security & App Lock</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          <p class="muted">${lock.hasLock() ? `${lock.lockType().toUpperCase()} lock is active.` : 'App lock is off.'} Protects app access on unattended devices.</p>
          <div class="row">
            <button class="btn" data-setlock>${lock.hasLock() ? 'Change Lock' : 'Set Lock'}</button>
            ${lock.hasLock() ? '<button class="btn danger" data-clearlock>Remove Lock</button>' : ''}
          </div>
          ${lock.hasLock() ? `
            <label class="field" style="margin-top:6px"><span>Lock after leaving the app for</span>
              <select data-lockmin>${[0, 1, 5, 15].map(m => `<option value="${m}" ${lock.minutes() === m ? 'selected' : ''}>${m ? m + ' min' : 'Immediately'}</option>`).join('')}</select>
            </label>
            ${toggleSwitch('bio', isBiometricEnabled(), 'Biometric Unlock', 'Use native fingerprint / biometric sensor to unlock', 'data-bio')}
          ` : ''}
        </div>
      </details>

      <!-- 4. Alerts & Safety Guards -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>🛡️</span><span>Alerts & Safety Guards</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          ${toggleSwitch('notify', localStorage.getItem('hisaab.notify') === '1' && globalThis.Notification?.permission === 'granted', 'Budget & Spend Notifications', 'Alerts for monthly limits and unusual spending', 'data-notify')}
          <label class="field" style="margin-top:6px">
            <span id="lbl-dup-window">Duplicate warning window (${p.dupWindow || 6} hours)</span>
            <input type="range" data-pref="dupWindow" min="1" max="24" step="1" value="${p.dupWindow || 6}">
          </label>
          <p class="muted">Flags accidental identical entries logged on the same fund within 1 to 24 hours.</p>

          ${toggleSwitch('brs', p.brsEnabled !== false, 'Bank & Cash Reconciliation (BRS)', 'Fast-audit tool on fund pages to match passbook/cash and park differences in Suspense', 'data-brs')}

          ${toggleSwitch('chillar', !!p.chillarEnabled, 'Chillar Saver (Round-Up to ₹5)', 'Auto-sweep spare change from expenses up to nearest multiple of ₹5 into your target Pot', 'data-chillar')}
          <div id="chillar-pot-picker" ${p.chillarEnabled ? '' : 'hidden'} style="margin-top:6px">
            <label class="field">
              <span>Target Savings Pot for Chillar Sweeps</span>
              <select data-chillar-pot class="dialog-input">
                <option value="">-- Select a Pot --</option>
                ${(pots || []).map(pot => `<option value="${pot.id}" ${p.chillarPotId === pot.id ? 'selected' : ''}>🏺 ${esc(pot.name)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
      </details>

      <!-- 5. AI Financial Co-Pilot -->
      <details class="settings-acc" id="ai-settings">
        <summary>
          <div class="acc-title"><span>🤖</span><span>AI Financial Co-Pilot</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          <p class="muted">Built-in local intelligence persona ("Munimji") works completely offline at zero cost. Custom API providers are also supported.</p>
          ${toggleSwitch('ai-enabled', aiCfg.enabled, 'Enable AI Financial Assistant', 'Munimji floating assistant for natural language accounting', 'data-ai-enabled')}
          
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
                <small class="muted" style="font-size:.76rem;margin-top:2px">Note: Browsers block direct calls to services like NVIDIA NIM due to CORS. Use OpenRouter or our app to run any AI freely.</small>
              </label>
            </div>
            <div id="ai-sysprompt-field" ${aiCfg.provider === 'local' ? 'hidden' : ''} style="display:grid;gap:6px">
              <label class="field">
                <span>Custom System Prompt (Optional)</span>
                <textarea data-ai-sysprompt rows="3" placeholder="Add specific accounting rules or personal instructions for the AI assistant…">${esc(aiCfg.systemPrompt || '')}</textarea>
              </label>
            </div>
            <div><button type="button" class="btn primary" data-ai-save>Save AI Settings</button></div>
          </div>
        </div>
      </details>

      <!-- 6. Data, Sync & Backup -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>💾</span><span>Data, Sync & Backup</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          <div class="rows">${link('#/statements', 'Statements', 'Export by day, month, fund, category, party…')}${link('#/audit', 'Audit trail', 'Every change to your data')}${link('#/logs', 'Logs', 'What the app did on this device')}</div>
          
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <span style="font-weight:600">Cloud Synchronization</span>
            <button type="button" class="btn" data-sync-now style="padding:4px 12px;font-size:.82rem">⚡ Sync Now</button>
          </div>
          ${toggleSwitch('sync', localStorage.getItem('hisaab.syncOn') !== '0', 'Auto Cloud Sync', `Status: ${sync.status()}`, 'data-sync')}
          <label class="field"><span>Sync interval</span>
            <select data-sync-interval>
              ${[0, 10, 30, 60].map(s => `<option value="${s}" ${sync.interval() === s ? 'selected' : ''}>${s ? (s < 60 ? s + 's' : '1m') : 'Manual only'}</option>`).join('')}
            </select>
          </label>

          <div class="row" style="margin-top:6px">
            <button class="btn" data-export>Export backup</button>
            <button class="btn" data-export-enc>Encrypted backup</button>
            <label class="btn">Import backup<input type="file" accept=".json,.enc.json,application/json,text/plain" data-import hidden></label>
          </div>

          <!-- Clean Reset / Wipe All Data -->
          <div style="margin-top:10px;padding-top:14px;border-top:1px solid var(--glass-line)">
            <button type="button" class="btn danger" data-wipe style="font-size:.82rem">${cloud.state().user ? 'Wipe Local & Cloud Data (Start Clean State)' : 'Wipe All Local Data (Clean Reset)'}</button>
            <p class="muted" style="margin-top:4px">Exports an emergency backup snapshot first, then permanently erases data.</p>
          </div>
        </div>
      </details>

      <!-- 7. Account & Family -->
      <section class="card glass form">
        <div class="top">
          <div>
            <h2>Account & Family Profiles</h2>
            <p class="muted">Active person: <b>${esc(profile.name)}</b> · Account: <b>${cloud.state().user ? (cloud.state().profile ? '@' + esc(cloud.state().profile.handle) : 'Signed in') : 'Guest / Local Profile'}</b></p>
          </div>
          <a class="btn primary" href="#/account" style="font-size:.82rem;font-weight:650">Manage Account & Family →</a>
        </div>
      </section>

      <!-- 8. Developer Support & Feedback -->
      <details class="settings-acc">
        <summary>
          <div class="acc-title"><span>💬</span><span>Connect with Developer</span></div>
          <svg class="acc-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div class="acc-body form">
          <p class="muted">Have feedback, ideas for improvement, or encountered a bug? Connect directly with the developer via Email or WhatsApp.</p>
          <div>
            <button type="button" class="btn primary" data-contact-dev style="display:inline-flex;align-items:center;gap:8px">
              <span>✉️ / 💬</span>
              <span>Send Bug / Feedback</span>
            </button>
          </div>
        </div>
      </details>

    </div>
  `;

  if (openIndexes.length > 0) {
    const accs = root.querySelectorAll('details.settings-acc');
    openIndexes.forEach(idx => { if (accs[idx]) accs[idx].open = true; });
  }

  root.oninput = e => {
    const k = e.target.dataset.pref;
    if (k) {
      setPref(k, Number(e.target.value));
      if (k === 'dupWindow') {
        const lbl = root.querySelector('#lbl-dup-window');
        if (lbl) lbl.textContent = `Duplicate warning window (${e.target.value} hours)`;
      } else if (k === 'soundVolume') {
        const lbl = root.querySelector('#lbl-sound-vol');
        if (lbl) lbl.textContent = `Sound volume (${Math.round(e.target.value * 100)}%)`;
        playTick();
      }
    }
  };

  root.onchange = async e => {
    const t = e.target;
    try {
      if (t.name === 'theme') setPref('theme', t.value);
      else if (t.name === 'mode') { setPref('mode', t.value); render(root); }
      else if (t.matches('[data-sound]')) {
        setPref('sound', t.checked);
        const vf = root.querySelector('#sound-vol-field');
        if (vf) vf.hidden = !t.checked;
        if (t.checked) playTick();
        toast(t.checked ? 'Click-clack mode: ON! Typing now sounds delightfully tactile ⌨️🎶' : 'Ninja stealth mode activated! Keyboard sound muted 🥷🤫');
      }
      else if (t.matches('[data-haptic]')) {
        setPref('haptics', t.checked);
        localStorage.setItem('hisaab.haptic', t.checked ? '1' : '0');
        if (t.checked) triggerHaptic(15);
        toast(t.checked ? 'Good vibrations enabled! Feel every tap 📳✨' : 'Vibrations quieted. Pure calm zen mode 🧘‍♂️');
      }
      else if (t.matches('[data-bio]')) {
        if (t.checked) {
          const avail = await isBiometricAvailable();
          if (!avail) {
            t.checked = false;
            toast('Your device lacks biometric sensors or platform authenticator 🤳🤷‍♂️');
            return;
          }
          const reg = await registerBiometric();
          if (reg) {
            toast('Fingerprint / Biometric authentication activated! 🛡️👆');
          } else {
            t.checked = false;
            setBiometricEnabled(false);
            toast('Biometric setup cancelled or timed out ✋');
          }
        } else {
          setBiometricEnabled(false);
          toast('Biometrics benched. Back to master lock 🔢🛡️');
        }
      }
      else if (t.matches('[data-lockmin]')) lock.setMinutes(Number(t.value));
      else if (t.matches('[data-sync]')) { localStorage.setItem('hisaab.syncOn', t.checked ? '1' : '0'); logger.info('Cloud sync toggled', { on: t.checked }); cloud.refresh(); }
      else if (t.matches('[data-sync-interval]')) { sync.setInterval(Number(t.value)); sync.schedule((k, d) => store.applyRemote(k, d, false)); toast('Sync clock wound up tight! We’ll keep tabs on schedule ⏱️☁️'); }
      else if (t.matches('[data-ai-enabled]')) {
        saveAiConfig({ enabled: t.checked });
        root.querySelector('#ai-body').hidden = !t.checked;
        const fabAi = document.querySelector('#fab-ai');
        if (fabAi) fabAi.hidden = !t.checked;
        toast(t.checked ? 'Munimji AI is awake and brewing financial wisdom ☕🤖' : 'Munimji AI sent on a well-deserved chai break 🫖😴');
      }
      else if (t.matches('[data-notify]')) {
        if (t.checked && globalThis.Notification && (await Notification.requestPermission()) === 'granted') {
          localStorage.setItem('hisaab.notify', '1');
          toast('Budget & spend notifications enabled! 🔔✨');
        } else {
          localStorage.setItem('hisaab.notify', '0');
          t.checked = false;
          toast('Notifications are blocked by your browser! Grant permission if you want alerts 🔔🙅‍♂️');
        }
      }
      else if (t.matches('[data-brs]')) {
        setPref('brsEnabled', t.checked);
        toast(t.checked ? 'Bank Reconciliation (BRS) active! ⚖️' : 'BRS tool hidden');
      }
      else if (t.matches('[data-chillar]')) {
        setPref('chillarEnabled', t.checked);
        const picker = root.querySelector('#chillar-pot-picker');
        if (picker) picker.hidden = !t.checked;
        toast(t.checked ? 'Chillar Saver active! Spare change sweeps to nearest ₹5 🏺' : 'Chillar Saver paused');
      }
      else if (t.matches('[data-chillar-pot]')) {
        setPref('chillarPotId', t.value);
        toast('Target Pot for Chillar Saver updated! 🏺✨');
      } else if (t.matches('[data-import]')) {
        let text = await t.files[0].text();
        if (isEncrypted(text)) {
          openSheet(`
            <h2>Encrypted Backup 🔐</h2>
            <p class="muted">This backup is encrypted. Enter the passphrase to restore.</p>
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
                toast('Abracadabra! Entire financial timeline restored flawlessly 🪄📜');
                render(root);
              } catch {
                toast('Passphrase rejected! The vault remains firmly shut 🙅‍♂️🔐');
              }
            };
          });
          return;
        }
        await store.importAll(text); toast('All records welcomed home! Backup imported like a charm 📂✨');
      } else if (t.matches('[data-ai-provider]')) {
        const val = t.value;
        const f = root.querySelector('#ai-fields'); if (f) f.hidden = val === 'local';
        const ep = root.querySelector('#ai-endpoint-field'); if (ep) ep.hidden = val !== 'custom';
        const sp = root.querySelector('#ai-sysprompt-field'); if (sp) sp.hidden = val === 'local';
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };

  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-reset]')) { resetPrefs(); render(root); }
      else if (t.closest('[data-sync-now]')) {
        toast('Beaming your ledgers to the cloud mothership… 🛸☁️');
        await sync.flush();
        toast('Cloud sync crystal clear! Your numbers are immortal now ☁️💎');
        render(root);
      }
      else if (t.closest('[data-export]')) {
        const ok = await saveWithPicker(`hisaab-backup-${today()}.json`, 'application/json', store.exportAll());
        if (ok) toast('Ledger snapshot packed and exported! Guard it like royal jewels 💎📦');
      }
      else if (t.closest('[data-export-enc]')) {
        openSheet(`
          <h2>Encrypted Backup 🔐</h2>
          <p class="muted">Choose a strong passphrase. <b>Important: If you forget this passphrase, this backup file is mathematically impossible to recover.</b></p>
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
            if (pass !== conf) return toast('Passphrases had a disagreement! Double check your typing 🧐🔑');
            const encData = await encrypt(store.exportAll(), pass);
            closeSheet();
            const ok = await saveWithPicker(`hisaab-backup-${today()}.enc.json`, 'application/json', encData);
            if (ok) toast('Fort Knox level encryption applied! Don’t lose that passphrase 🔐🛡️');
          };
        });
      }
      else if (t.closest('[data-setlock]') || t.closest('[data-setpin]')) {
        openSetLockModal(root);
      }
      else if (t.closest('[data-clearlock]') || t.closest('[data-clearpin]')) {
        const ok = await confirmModal({
          title: 'Remove Security Lock? 🔓',
          message: 'Anyone with access to this device will be able to view your financial records without authentication.',
          confirmText: 'Remove Lock',
          danger: true
        });
        if (ok) {
          lock.clearPin();
          logger.info('Lock cleared');
          toast('Vault door unlocked! Anyone with your phone can peek now 🔓👀');
          render(root);
        }
      }
      else if (t.closest('[data-wipe]')) {
        const isCloud = !!cloud.state().user;
        const ok = await confirmModal({
          title: isCloud ? 'Wipe Local & Cloud Data? ⚠️' : 'Wipe All Local Data? ⚠️',
          message: `This will irreversibly delete all accounts, transactions, categories, and settings${isCloud ? ' BOTH on this device and in the cloud' : ' on this device'}. A fail-safe emergency backup snapshot will be automatically downloaded to your device before erasure.`,
          confirmText: 'Continue to Erase',
          danger: true
        });
        if (ok) {
          const typed = await promptModal({
            title: 'Confirm Reset 🧼',
            message: 'Type the word RESET in capital letters to confirm permanent erasure:',
            placeholder: 'RESET',
            confirmText: 'Permanently Erase',
            cancelText: 'Cancel'
          });
          if (typed === 'RESET') {
            // Step 1: Force download fail-safe emergency backup snapshot
            download(`hisaab-emergency-backup-${today()}.json`, 'application/json', store.exportAll());
            toast('Lifeline backup downloaded! Safety net secured before destruction 🪂💾');

            // Step 2: If signed in with Google, purge cloud records
            if (isCloud) {
              try {
                toast('Sweeping the cloud clean like a neat freak… 🧹☁️');
                await cloud.wipeCloudData();
              } catch (err) {
                toast('Cloud wipe warning: ' + err.message);
              }
            }

            // Step 3: Clear local storage & IndexedDB
            localStorage.clear();
            sessionStorage.clear();
            try {
              const dbs = (await window.indexedDB?.databases?.()) || [];
              for (const d of dbs) { if (d.name) window.indexedDB.deleteDatabase(d.name); }
            } catch {}
            toast('Tabula rasa! Slate wiped clean like brand new snow 🧼✨');
            setTimeout(() => { location.hash = '#/home'; location.reload(); }, 800);
          } else if (typed !== null) {
            toast('Phew! Typing didn’t match. Your data lives another day! 😅🛡️');
          }
        }
      }
      else if (t.closest('[data-ai-save]')) {
        const key = root.querySelector('[data-ai-key]').value.trim();
        const model = root.querySelector('[data-ai-model]').value.trim();
        const endpoint = root.querySelector('[data-ai-endpoint]')?.value.trim() || '';
        const systemPrompt = root.querySelector('[data-ai-sysprompt]').value.trim();
        const provider = root.querySelector('[data-ai-provider]').value;

        saveAiConfig({ apiKey: key, model, endpoint, systemPrompt, provider });
        toast('Munimji AI brain settings updated! Ready to crunch numbers 🧠📊');
      }
      else if (t.closest('[data-contact-dev]')) {
        openContactDevModal();
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };
}

export function openContactDevModal() {
  const { profile } = store.live();
  const cState = cloud.state();
  const name = profile?.name || cState.user?.displayName || 'Hisaab User';
  const email = cState.user?.email || 'Not signed in (Local / Guest)';
  const chatId = cState.profile?.handle ? `@${cState.profile.handle}` : (cState.user?.uid ? cState.user.uid.slice(0, 12) : profile.id.slice(0, 8));
  const userSinceDate = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  openSheet(`
    <div style="display:grid;gap:12px;padding:4px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;font-size:1.3rem">💬 Connect with Developer</h2>
        <span class="muted" style="font-size:.8rem;font-weight:600">Feedback & Bugs</span>
      </div>
      <p class="muted" style="margin:0;font-size:.85rem;line-height:1.4">
        Direct bridge to Suffu (developer). Send bug reports or feature improvements straight to Email or WhatsApp!
      </p>

      <form id="contact-dev-form" class="form" style="display:grid;gap:10px">
        <div class="seg" style="margin-bottom:2px">
          <label><input type="radio" name="feedbackType" value="Feedback for improvement 💡" checked><span>💡 Feedback</span></label>
          <label><input type="radio" name="feedbackType" value="Bug / Error in app 🐛"><span>🐛 Bug Report</span></label>
        </div>

        <label class="field">
          <span>Your Name <small class="muted">(Editable)</small></span>
          <input name="senderName" value="${esc(name)}" required autocomplete="name">
        </label>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px">
          <label class="field" style="min-width:0">
            <span>Email</span>
            <input value="${esc(email)}" disabled style="opacity:0.75;cursor:not-allowed;min-width:0;width:100%;text-overflow:ellipsis">
          </label>
          <label class="field" style="min-width:0">
            <span>User Since</span>
            <input value="${esc(userSinceDate)}" disabled style="opacity:0.75;cursor:not-allowed;min-width:0;width:100%;text-overflow:ellipsis">
          </label>
        </div>

        <label class="field">
          <span>User / Chat ID</span>
          <input value="${esc(chatId)}" disabled style="opacity:0.75;cursor:not-allowed">
        </label>

        <label class="field">
          <span style="display:flex;justify-content:space-between">
            <span>Notes / Description</span>
            <span id="word-count-badge" class="muted" style="font-size:.78rem">0 / ~60 words</span>
          </span>
          <textarea name="notes" id="contact-notes" rows="4" required placeholder="Describe what happened or what could be improved... (~60 words)"></textarea>
        </label>

        <div class="ai-confirm-done" style="background:var(--accent-soft);color:var(--accent);font-size:.8rem;padding:8px 12px;border-radius:calc(var(--radius)*.5)">
          📸 <b>Tip:</b> You are encouraged to attach a screenshot directly in your Email or WhatsApp chat for contextual details!
        </div>

        <div class="row" style="margin-top:4px">
          <button type="button" class="btn" id="btn-send-email" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px">
            <span>✉️</span><span>Send via Email</span>
          </button>
          <button type="button" class="btn primary" id="btn-send-whatsapp" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px">
            <span>💬</span><span>Send via WhatsApp</span>
          </button>
        </div>

        <small class="muted" style="display:block;margin-top:6px;text-align:center;font-size:.74rem;line-height:1.35">
          🔒 Disclaimer: Your message will be reviewed directly by a human developer and considered for upcoming app updates.
        </small>
      </form>
    </div>
  `, el => {
    const notesEl = el.querySelector('#contact-notes');
    const wordBadge = el.querySelector('#word-count-badge');
    const form = el.querySelector('#contact-dev-form');

    const updateCount = () => {
      const text = notesEl.value.trim();
      const words = text ? text.split(/\s+/).length : 0;
      wordBadge.textContent = `${words} / ~60 words`;
      if (words > 75) {
        wordBadge.style.color = 'var(--neg)';
      } else {
        wordBadge.style.color = '';
      }
    };
    notesEl.addEventListener('input', updateCount);

    const getPayload = () => {
      const fd = new FormData(form);
      const senderName = (fd.get('senderName') || name).trim();
      const type = fd.get('feedbackType');
      const notes = (notesEl.value || '').trim();
      if (!notes) {
        toast('Please enter a few words in Notes before sending! ✍️');
        notesEl.focus();
        return null;
      }
      return { senderName, type, notes };
    };

    // 1. Send via Email (mirsuffu@gmail.com)
    el.querySelector('#btn-send-email')?.addEventListener('click', () => {
      const p = getPayload();
      if (!p) return;
      const subject = encodeURIComponent(`[Hisaab ${p.type.includes('Bug') ? 'Bug' : 'Feedback'}] from ${p.senderName}`);
      const body = encodeURIComponent(
        `*Hisaab ${p.type}*\n\n` +
        `• Name: ${p.senderName}\n` +
        `• Email: ${email}\n` +
        `• User Since: ${userSinceDate}\n` +
        `• ID: ${chatId}\n` +
        `• App Mode: ${prefs().mode || 'standard'}\n\n` +
        `--- Description ---\n` +
        `${p.notes}\n\n` +
        `[Note: Please attach any relevant screenshot to this email!]`
      );
      window.open(`mailto:mirsuffu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      closeSheet();
      toast('Drafted in your email app! Don’t forget to hit send ✉️🚀');
    });

    // 2. Send via WhatsApp (+919422872892)
    el.querySelector('#btn-send-whatsapp')?.addEventListener('click', () => {
      const p = getPayload();
      if (!p) return;
      const waText = encodeURIComponent(
        `*Hisaab App ${p.type}*\n\n` +
        `• *Name:* ${p.senderName}\n` +
        `• *Email:* ${email}\n` +
        `• *User Since:* ${userSinceDate}\n` +
        `• *ID:* ${chatId}\n\n` +
        `*Description:*\n` +
        `${p.notes}\n\n` +
        `_(Attaching screenshot below if relevant)_`
      );
      window.open(`https://wa.me/919422872892?text=${waText}`, '_blank');
      closeSheet();
      toast('Opening WhatsApp with prefilled message! 💬🚀');
    });
  });
}

function initPatternCanvas(canvas, { onEnd }) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width, padding = Math.round(size * 0.166), gap = (size - 2 * padding) / 2;
  const dots = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      dots.push({ idx: r * 3 + c, x: padding + c * gap, y: padding + r * gap });
    }
  }

  let activeSeq = [];
  let isDrawing = false;
  let curPointer = null;

  const drawGrid = () => {
    ctx.clearRect(0, 0, size, size);
    if (activeSeq.length > 1) {
      ctx.beginPath();
      const first = dots[activeSeq[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < activeSeq.length; i++) {
        const pt = dots[activeSeq[i]];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = 'hsl(var(--accent-h) var(--accent-s) 52%)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (isDrawing && curPointer && activeSeq.length > 0) {
      const last = dots[activeSeq[activeSeq.length - 1]];
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(curPointer.x, curPointer.y);
      ctx.strokeStyle = 'hsl(var(--accent-h) var(--accent-s) 52% / 0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    dots.forEach(d => {
      const isSel = activeSeq.includes(d.idx);
      ctx.beginPath();
      ctx.arc(d.x, d.y, isSel ? 10 : 7, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? 'hsl(var(--accent-h) var(--accent-s) 52%)' : 'rgba(150, 150, 150, 0.4)';
      ctx.fill();
      if (isSel) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsl(var(--accent-h) var(--accent-s) 52% / 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  };

  drawGrid();

  const getCoord = e => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const checkHit = pt => {
    for (const d of dots) {
      if (!activeSeq.includes(d.idx) && Math.hypot(d.x - pt.x, d.y - pt.y) < 24) return d.idx;
    }
    return null;
  };

  const connectDot = dotIdx => {
    const added = lock.resolvePatternBridges(activeSeq, dotIdx);
    if (added && added.length > 0) {
      activeSeq.push(...added);
      triggerHaptic(6);
      playTick();
      drawGrid();
    }
  };

  const startDraw = e => {
    isDrawing = true;
    activeSeq = [];
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const pt = getCoord(e);
    curPointer = pt;
    const hit = checkHit(pt);
    if (hit !== null) connectDot(hit);
    drawGrid();
  };

  const moveDraw = e => {
    if (!isDrawing) return;
    const pt = getCoord(e);
    curPointer = pt;
    const hit = checkHit(pt);
    if (hit !== null) connectDot(hit);
    drawGrid();
  };

  const endDraw = e => {
    if (!isDrawing) return;
    isDrawing = false;
    curPointer = null;
    try { if (e?.pointerId) canvas.releasePointerCapture(e.pointerId); } catch {}
    drawGrid();
    onEnd?.(activeSeq, () => {
      activeSeq = [];
      drawGrid();
    });
  };

  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', moveDraw);
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  return {
    clear: () => {
      activeSeq = [];
      drawGrid();
    },
    draw: drawGrid,
    getSequence: () => [...activeSeq]
  };
}

function openVerifyPatternStep(root) {
  openSheet(`
    <h2>Verify Current Pattern ⠇</h2>
    <p class="muted">Draw your current pattern to authorize changing the lock.</p>
    <div style="display:grid;gap:10px;text-align:center;margin:12px auto">
      <p class="muted" id="verify-pat-status" style="font-size:.84rem;margin:0">Draw current pattern:</p>
      <div style="position:relative;width:240px;height:240px;margin:4px auto;touch-action:none">
        <canvas id="verify-pat-canvas" width="240" height="240" style="display:block;width:240px;height:240px;border-radius:14px;background:var(--bg);box-shadow:inset 3px 3px 7px var(--sh-lo), inset -3px -3px 7px var(--sh-hi)"></canvas>
      </div>
      <div>
        <button type="button" class="btn-micro" id="btn-verify-clear">Clear</button>
        <button type="button" class="btn-micro" data-close style="margin-left:8px">Cancel</button>
      </div>
    </div>
  `, el => {
    const canvas = el.querySelector('#verify-pat-canvas');
    const status = el.querySelector('#verify-pat-status');
    const patHandler = initPatternCanvas(canvas, {
      onEnd: async (seq, reset) => {
        if (seq.length < 4) {
          status.textContent = '⚠️ Pattern needs at least 4 dots. Redraw:';
          status.style.color = 'var(--neg)';
          return;
        }
        const patternStr = seq.join('-');
        if (await lock.verify(patternStr)) {
          toast('Current pattern verified! 👍');
          openNewLockSetup(root);
        } else {
          status.textContent = '❌ Incorrect pattern! Try again:';
          status.style.color = 'var(--neg)';
          triggerHaptic(30);
          setTimeout(reset, 400);
        }
      }
    });
    el.querySelector('#btn-verify-clear')?.addEventListener('click', () => {
      patHandler.clear();
      status.textContent = 'Draw current pattern:';
      status.style.color = '';
    });
  });
}

function openVerifyPinStep(root) {
  openSheet(`
    <h2>Verify Current PIN 🔢</h2>
    <p class="muted">Enter your current PIN to authorize changing the lock.</p>
    <form id="verify-pin-form" class="form" style="display:grid;gap:14px;margin-top:10px" autocomplete="off">
      <label class="field">
        <span>Current PIN</span>
        <input type="text" inputmode="numeric" name="hisaab_auth_token" maxlength="8" autocomplete="off" data-lpignore="true" data-form-type="other" required placeholder="Enter current PIN" autofocus class="dialog-input" style="-webkit-text-security:disc">
      </label>
      <div style="display:flex;gap:10px;margin-top:4px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">Verify & Continue</button>
      </div>
    </form>
  `, el => {
    el.querySelector('#verify-pin-form').onsubmit = async evt => {
      evt.preventDefault();
      const val = evt.target.hisaab_auth_token.value.trim();
      if (await lock.verify(val)) {
        toast('Current PIN verified! 👍');
        openNewLockSetup(root);
      } else {
        toast('Current PIN is incorrect! 🧐');
        triggerHaptic(30);
      }
    };
  });
}

function openVerifyPasswordStep(root) {
  openSheet(`
    <h2>Verify Current Password 🔑</h2>
    <p class="muted">Enter your current password to authorize changing the lock.</p>
    <form id="verify-pass-form" class="form" style="display:grid;gap:14px;margin-top:10px" autocomplete="off">
      <label class="field">
        <span>Current Password</span>
        <input type="text" name="hisaab_auth_token" autocomplete="off" data-lpignore="true" data-form-type="other" required placeholder="Enter current password" autofocus class="dialog-input" style="-webkit-text-security:disc">
      </label>
      <div style="display:flex;gap:10px;margin-top:4px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">Verify & Continue</button>
      </div>
    </form>
  `, el => {
    el.querySelector('#verify-pass-form').onsubmit = async evt => {
      evt.preventDefault();
      const val = evt.target.hisaab_auth_token.value;
      if (await lock.verify(val)) {
        toast('Current password verified! 👍');
        openNewLockSetup(root);
      } else {
        toast('Current password is incorrect! 🧐');
        triggerHaptic(30);
      }
    };
  });
}

export function openSetLockModal(root) {
  if (lock.hasLock()) {
    const curType = lock.lockType() || 'pin';
    if (curType === 'pattern') return openVerifyPatternStep(root);
    if (curType === 'password') return openVerifyPasswordStep(root);
    return openVerifyPinStep(root);
  }
  openNewLockSetup(root);
}

function openNewLockSetup(root) {
  let selectedType = lock.lockType() || 'pin';
  let recordedPattern = '';

  openSheet(`
    <h2>${lock.hasLock() ? 'Set New Security Lock 🔒' : 'Set Security Lock 🔒'}</h2>
    <p class="muted">Protect app access on unattended devices.</p>

    <form id="lock-setup-form" class="form" style="display:grid;gap:12px;margin-top:6px" autocomplete="off">
      <label class="field"><span>Lock Type</span></label>
      <div class="seg" id="sec-type-seg">
        <label><input type="radio" name="lockTypeChoice" value="pin" ${selectedType === 'pin' ? 'checked' : ''}><span>🔢 PIN</span></label>
        <label><input type="radio" name="lockTypeChoice" value="pattern" ${selectedType === 'pattern' ? 'checked' : ''}><span>⠇ Pattern</span></label>
        <label><input type="radio" name="lockTypeChoice" value="password" ${selectedType === 'password' ? 'checked' : ''}><span>🔑 Password</span></label>
      </div>

      <!-- 1. PIN Fields -->
      <div id="sec-pin-panel" ${selectedType === 'pin' ? '' : 'hidden'} style="display:grid;gap:10px">
        <label class="field">
          <span>New PIN (4–8 digits)</span>
          <input type="text" inputmode="numeric" name="hisaab_new_pin" maxlength="8" autocomplete="off" data-lpignore="true" data-form-type="other" placeholder="4 to 8 digits" style="-webkit-text-security:disc">
        </label>
        <label class="field">
          <span>Confirm PIN</span>
          <input type="text" inputmode="numeric" name="hisaab_new_pin_confirm" maxlength="8" autocomplete="off" data-lpignore="true" data-form-type="other" placeholder="Re-enter PIN" style="-webkit-text-security:disc">
        </label>
      </div>

      <!-- 2. Pattern Fields -->
      <div id="sec-pattern-panel" ${selectedType === 'pattern' ? '' : 'hidden'} style="display:grid;gap:8px;text-align:center">
        <p class="muted" id="pat-status-msg" style="font-size:.82rem;margin:0">Draw pattern connecting at least 4 dots:</p>
        <div style="position:relative;width:240px;height:240px;margin:4px auto;touch-action:none">
          <canvas id="pat-canvas" width="240" height="240" style="display:block;width:240px;height:240px;border-radius:14px;background:var(--bg);box-shadow:inset 3px 3px 7px var(--sh-lo), inset -3px -3px 7px var(--sh-hi)"></canvas>
        </div>
        <div>
          <button type="button" class="btn-micro" id="btn-clear-pat">Clear / Redraw</button>
        </div>
      </div>

      <!-- 3. Password Fields -->
      <div id="sec-pass-panel" ${selectedType === 'password' ? '' : 'hidden'} style="display:grid;gap:10px">
        <label class="field">
          <span>New Password</span>
          <input type="text" name="hisaab_new_pass" minlength="4" autocomplete="off" data-lpignore="true" data-form-type="other" placeholder="Min 4 characters" style="-webkit-text-security:disc">
        </label>
        <label class="field">
          <span>Confirm Password</span>
          <input type="text" name="hisaab_new_pass_confirm" minlength="4" autocomplete="off" data-lpignore="true" data-form-type="other" placeholder="Re-type password" style="-webkit-text-security:disc">
        </label>
      </div>

      <!-- Master Recovery Passphrase -->
      <label class="field" style="margin-top:4px">
        <span>Master Recovery Passphrase (Recommended)</span>
        <input type="text" name="recovery" placeholder="e.g. secret recovery word (used if forgotten)" autocomplete="off" data-lpignore="true">
        <small class="muted" style="font-size:.74rem">If you ever forget your lock, this phrase safely resets it.</small>
      </label>

      <div style="display:flex;gap:10px;margin-top:6px">
        <button type="button" class="btn" data-close style="flex:1">Cancel</button>
        <button type="submit" class="btn primary" style="flex:1">Save Lock</button>
      </div>
    </form>
  `, el => {
    const form = el.querySelector('#lock-setup-form');
    const seg = el.querySelector('#sec-type-seg');
    const pinPanel = el.querySelector('#sec-pin-panel');
    const patPanel = el.querySelector('#sec-pattern-panel');
    const passPanel = el.querySelector('#sec-pass-panel');
    const patStatus = el.querySelector('#pat-status-msg');
    const canvas = el.querySelector('#pat-canvas');
    const clearBtn = el.querySelector('#btn-clear-pat');

    let patHandler = null;
    if (canvas) {
      patHandler = initPatternCanvas(canvas, {
        onEnd: seq => {
          if (seq.length < 4) {
            patStatus.textContent = '⚠️ Pattern needs at least 4 dots. Redraw:';
            patStatus.style.color = 'var(--neg)';
            recordedPattern = '';
          } else {
            recordedPattern = seq.join('-');
            patStatus.textContent = `✓ Pattern recorded (${seq.length} dots connected)!`;
            patStatus.style.color = 'var(--pos)';
          }
        }
      });
    }

    const updatePanels = type => {
      selectedType = type;
      pinPanel.hidden = type !== 'pin';
      patPanel.hidden = type !== 'pattern';
      passPanel.hidden = type !== 'password';
      if (type === 'pattern' && patHandler) patHandler.draw();
    };

    seg?.addEventListener('change', e => {
      if (e.target.name === 'lockTypeChoice') updatePanels(e.target.value);
    });

    clearBtn?.addEventListener('click', () => {
      patHandler?.clear();
      recordedPattern = '';
      patStatus.textContent = 'Draw pattern connecting at least 4 dots:';
      patStatus.style.color = '';
    });

    form.onsubmit = async evt => {
      evt.preventDefault();
      const fd = new FormData(form);

      let secret = '';
      if (selectedType === 'pin') {
        const pin = fd.get('hisaab_new_pin')?.trim();
        const conf = fd.get('hisaab_new_pin_confirm')?.trim();
        if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4 to 8 numeric digits 🔢');
        if (pin !== conf) return toast('PINs do not match! Please check again 🙈');
        secret = pin;
      } else if (selectedType === 'pattern') {
        if (!recordedPattern) {
          return toast('Please draw a pattern connecting at least 4 dots ⠇');
        }
        secret = recordedPattern;
      } else if (selectedType === 'password') {
        const pass = fd.get('hisaab_new_pass');
        const conf = fd.get('hisaab_new_pass_confirm');
        if (!pass || pass.length < 4) return toast('Password must be at least 4 characters 🔑');
        if (pass !== conf) return toast('Passwords do not match! Please check again 🙈');
        secret = pass;
      }

      const rec = (fd.get('recovery') || '').trim();
      await lock.setLock(selectedType, secret, lock.minutes(), rec);
      logger.info('Lock updated', { type: selectedType });
      closeSheet();
      toast(`${selectedType.toUpperCase()} lock sealed in wax! Unauthorized snoopers locked out 🔒🛡️`);
      render(root);
    };
  });
}

