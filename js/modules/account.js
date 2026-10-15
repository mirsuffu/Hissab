// Dedicated Account & Profiles view for Hisaab
import { store } from '../core/store.js';
import * as cloud from '../core/cloud.js';
import { sync } from '../core/sync.js';
import { today, compressImage } from '../core/models.js';
import { esc, toast, icon, openSheet, closeSheet, confirmModal, promptModal } from '../ui.js';
import { encrypt, decrypt, isEncrypted } from '../core/crypto.js';
import { saveWithPicker } from '../core/export.js';

export function render(root) {
  if (!root._cloudSubscribed) {
    root._cloudSubscribed = true;
    cloud.onChange(() => {
      if (root.isConnected) render(root);
    });
  }

  const c = cloud.state();
  const { profiles, profile } = store.live();
  const syncOn = localStorage.getItem('hisaab.syncOn') !== '0';

  const avatarSrc = profile.dp || c.user?.photoURL;
  const avatar = avatarSrc
    ? `<img class="ac-avatar-img" src="${esc(avatarSrc)}" alt="Avatar" referrerpolicy="no-referrer">`
    : `<div class="ac-avatar-initials">${esc((c.profile?.name || profile.name || 'U').charAt(0).toUpperCase())}</div>`;

  root.innerHTML = `
    <header class="top">
      <div>
        <h1>Account & Profile</h1>
        <p class="muted">Manage your identity, sync, and family profiles.</p>
      </div>
    </header>

    <section class="hero raised ac-card">
      <div class="ac-user-row">
        <label class="ac-avatar-wrap" title="Click to upload profile photo" style="position:relative;cursor:pointer;border-radius:50%;display:grid;place-items:center">
          ${avatar}
          <span class="ac-dp-badge" style="position:absolute;bottom:0;right:0;background:var(--accent);color:#fff;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font-size:12px;border:2px solid var(--bg);box-shadow:0 2px 5px rgba(0,0,0,.25)">📷</span>
          <input type="file" accept="image/*" id="ac-dp-input" hidden>
        </label>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:10px">
            <h2 style="font-size:1.4rem;margin:0">${esc(profile.name || c.profile?.name || c.user?.displayName)}</h2>
            <button class="btn-micro" id="ac-edit-name-btn" title="Edit name" style="font-size:.8rem;cursor:pointer">✏️ Edit</button>
          </div>
          ${c.user ? (c.profile ? `<p class="muted">@${esc(c.profile.handle)} · Cloud Active</p>` : `<p class="muted">${esc(c.user.email || 'Online')}</p>`) : '<p class="muted">Guest / Local Profile (100% Private Offline)</p>'}
        </div>
      </div>
      <div class="row">
        ${!c.user ? '<button class="btn primary" data-signin>Sign in with Google</button>' : '<button class="btn" data-signout>Disconnect Google (Switch to Guest)</button>'}
        ${!c.profile && c.user ? '<a class="btn primary" href="#/chat">Choose Chat ID</a>' : ''}
      </div>
    </section>

    <section class="card glass form">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>Cloud Backup & Sync</h2>
        <button type="button" class="btn" data-sync-now style="padding:4px 12px;font-size:.82rem" ${!c.user ? 'disabled' : ''}>⚡ Sync Now</button>
      </div>
      <p class="muted">${c.user ? 'Zero-cost synchronization using Firebase Firestore.' : 'Sign in above to enable automatic backup and cross-device sync.'}</p>
      <label class="pill">
        <input type="checkbox" data-sync ${syncOn ? 'checked' : ''} ${!c.user ? 'disabled' : ''}>
        <span>Back up and sync my data</span>
      </label>
      <p class="muted">Status: <b>${sync.status()}</b> · Interval: <b>${sync.interval() === 0 ? 'Real-time' : (sync.interval() / 60) + ' min'}</b></p>
    </section>

    <section class="card glass form">
      <h2>Family Profiles</h2>
      <p class="muted">Each person on this device keeps separate funds. Active: <b>${esc(profile.name)}</b></p>
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
      <form id="add-profile-form" class="row">
        <label class="field" style="flex:1">
          <span>Add person / profile</span>
          <input name="name" placeholder="Name" required autocomplete="off">
        </label>
        <button class="btn">Add</button>
      </form>
    </section>

    <section class="card glass form">
      <h2>Data Backup</h2>
      <div class="row">
        <button class="btn" data-export>Export Backup</button>
        <button class="btn" data-export-enc>Encrypted Backup</button>
        <label class="btn">Import Backup<input type="file" accept=".json,.enc.json,application/json,text/plain" data-import hidden></label>
      </div>
    </section>
  `;

  const date = today;

  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-signin]')) await cloud.signIn();
      else if (t.closest('[data-signout]')) { await cloud.signOut(); render(root); }
      else if (t.closest('#ac-edit-name-btn')) {
        const newName = await promptModal({
          title: 'Edit Name ✏️',
          message: 'What should we call you on this device?',
          defaultValue: profile.name || '',
          placeholder: 'Your name or moniker'
        });
        if (newName && newName.trim()) {
          await store.updateProfile(profile.id, { name: newName.trim() });
          if (c.user && c.profile) {
            try { await cloud.updateProfile({ name: newName.trim() }); } catch {}
          }
          toast('New alias registered! Looking sharp, boss 😎✏️');
          render(root);
        }
      }
      else if (t.closest('[data-sync-now]')) {
        toast('Beaming your ledgers to the cloud mothership… 🛸☁️');
        await sync.flush();
        toast('Cloud sync crystal clear! Your numbers are immortal now ☁️💎');
        render(root);
      }
      else if (t.closest('[data-profile]')) {
        store.switchProfile(t.closest('[data-profile]').dataset.profile);
        render(root);
      }
      else if (t.closest('[data-del-profile]')) {
        const id = t.closest('[data-del-profile]').dataset.delProfile;
        const pTarget = profiles.find(x => x.id === id);
        const ok = await confirmModal({
          title: `Delete Profile? 👤`,
          message: `Delete profile "${pTarget?.name || 'this person'}"? Past records will remain safe in the audit trail.`,
          confirmText: 'Delete Profile',
          danger: true
        });
        if (!ok) return;
        await store.deleteProfile(id);
        toast('Profile archived into memory. Farewell! 👋🗂️');
        render(root);
      }
      else if (t.closest('[data-export]')) {
        const ok = await saveWithPicker(`hisaab-backup-${date()}.json`, 'application/json', store.exportAll());
        if (ok) toast('Ledger snapshot packed and exported! Guard it like royal jewels 💎📦');
      }
      else if (t.closest('[data-export-enc]')) {
        openSheet(`
          <h2>Encrypted Backup 🔐</h2>
          <p class="muted">Choose a passphrase (min 8 characters). You will need it to restore this file.</p>
          <form id="ac-enc-form" class="form">
            <label class="field"><span>Passphrase</span><input type="password" name="pass" required minlength="8" placeholder="Passphrase (min 8 chars)"></label>
            <label class="field"><span>Confirm Passphrase</span><input type="password" name="confirm" required minlength="8" placeholder="Type again"></label>
            <button class="btn primary">Download Encrypted Backup</button>
          </form>
        `, el => {
          el.querySelector('#ac-enc-form').onsubmit = async evt => {
            evt.preventDefault();
            const pass = evt.target.pass.value;
            const conf = evt.target.confirm.value;
            if (pass !== conf) return toast('Passphrases had a disagreement! Double check your typing 🧐🔑');
            const encData = await encrypt(store.exportAll(), pass);
            closeSheet();
            const ok = await saveWithPicker(`hisaab-backup-${date()}.enc.json`, 'application/json', encData);
            if (ok) toast('Fort Knox level encryption applied! Don’t lose that passphrase 🔐🛡️');
          };
        });
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };

  root.onchange = async e => {
    const t = e.target;
    try {
      if (t.matches('#ac-dp-input')) {
        const file = t.files?.[0];
        if (!file) return;
        toast('Polishing profile picture to perfection… 📸✨');
        const compressedDp = await compressImage(file, 160, 0.85);
        await store.updateProfile(profile.id, { dp: compressedDp });
        toast('Look at that dashing display picture! Profile glow-up complete 📸✨');
        render(root);
      } else if (t.matches('[data-sync]')) {
        localStorage.setItem('hisaab.syncOn', t.checked ? '1' : '0');
        cloud.refresh();
        render(root);
      } else if (t.matches('[data-import]')) {
        let text = await t.files[0].text();
        if (isEncrypted(text)) {
          openSheet(`
            <h2>Import Encrypted Backup 🔐</h2>
            <form id="ac-import-enc-form" class="form">
              <label class="field"><span>Backup Passphrase</span><input type="password" name="pass" required placeholder="Enter passphrase"></label>
              <button class="btn primary">Decrypt & Restore</button>
            </form>
          `, el => {
            el.querySelector('#ac-import-enc-form').onsubmit = async evt => {
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
        await store.importAll(text);
        toast('All records welcomed home! Backup imported like a charm 📂✨');
        render(root);
      }
    } catch (err) { toast(err.message || 'Import failed'); }
  };

  const pfForm = root.querySelector('#add-profile-form');
  if (pfForm) {
    pfForm.onsubmit = async e => {
      e.preventDefault();
      const name = pfForm.name.value.trim();
      if (!name) return;
      await store.addProfile(name);
      toast('New family ledger spawned! Welcome to the hisaab circle 👨‍👩‍👧‍👦🎉');
      render(root);
    };
  }
}
