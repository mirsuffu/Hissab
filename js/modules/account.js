// Dedicated Account & Profiles view for Hisaab
import { store } from '../core/store.js';
import * as cloud from '../core/cloud.js';
import { sync } from '../core/sync.js';
import { esc, toast, icon, openSheet, closeSheet } from '../ui.js';
import { encrypt, decrypt, isEncrypted } from '../core/crypto.js';
import { download } from '../core/export.js';

export function render(root) {
  const c = cloud.state();
  const { profiles, profile } = store.live();
  const syncOn = localStorage.getItem('hisaab.syncOn') === '1';

  const avatar = c.user?.photoURL
    ? `<img class="ac-avatar-img" src="${esc(c.user.photoURL)}" alt="Avatar" referrerpolicy="no-referrer">`
    : `<div class="ac-avatar-initials">${esc((c.profile?.name || profile.name || 'U').charAt(0).toUpperCase())}</div>`;

  root.innerHTML = `
    <header class="top">
      <div>
        <h1>Account & Profile</h1>
        <p class="muted">Manage your identity, sync, and family profiles.</p>
      </div>
      <a class="btn" href="#/settings">Settings</a>
    </header>

    <section class="hero raised ac-card">
      <div class="ac-user-row">
        ${avatar}
        <div>
          <h2 style="font-size:1.4rem">${esc(c.profile?.name || c.user?.displayName || profile.name)}</h2>
          ${c.user ? (c.profile ? `<p class="muted">@${esc(c.profile.handle)} · Cloud Active</p>` : `<p class="muted">${esc(c.user.email || 'Online')}</p>`) : '<p class="muted">Guest / Local Profile (100% Private Offline)</p>'}
        </div>
      </div>
      <div class="row">
        ${!c.user ? '<button class="btn primary" data-signin>Sign in with Google</button>' : '<button class="btn" data-signout>Disconnect Google (Switch to Guest)</button>'}
        ${!c.profile && c.user ? '<a class="btn primary" href="#/chat">Choose Chat ID</a>' : ''}
      </div>
    </section>

    <section class="card glass form">
      <h2>Cloud Backup & Sync</h2>
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
        <label class="btn">Import Backup<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
    </section>
  `;

  const date = () => new Date().toISOString().slice(0, 10);

  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-signin]')) await cloud.signIn();
      else if (t.closest('[data-signout]')) { await cloud.signOut(); render(root); }
      else if (t.closest('[data-profile]')) {
        store.switchProfile(t.closest('[data-profile]').dataset.profile);
        render(root);
      }
      else if (t.closest('[data-del-profile]')) {
        const id = t.closest('[data-del-profile]').dataset.delProfile;
        const pTarget = profiles.find(x => x.id === id);
        if (!confirm(`Delete profile "${pTarget?.name || 'this person'}"? Past records will remain in the audit trail.`)) return;
        await store.deleteProfile(id);
        toast('Profile deleted');
        render(root);
      }
      else if (t.closest('[data-export]')) {
        download(`hisaab-backup-${date()}.json`, 'application/json', store.exportAll());
      }
      else if (t.closest('[data-export-enc]')) {
        openSheet(`
          <h2>Encrypted Backup</h2>
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
            if (pass !== conf) return toast('Passphrases did not match');
            const encData = await encrypt(store.exportAll(), pass);
            download(`hisaab-backup-${date()}.enc.json`, 'application/json', encData);
            closeSheet();
            toast('Encrypted backup saved');
          };
        });
      }
    } catch (err) { toast(err.message || 'That didn’t work'); }
  };

  root.onchange = async e => {
    const t = e.target;
    try {
      if (t.matches('[data-sync]')) {
        localStorage.setItem('hisaab.syncOn', t.checked ? '1' : '0');
        cloud.refresh();
        render(root);
      } else if (t.matches('[data-import]')) {
        let text = await t.files[0].text();
        if (isEncrypted(text)) {
          openSheet(`
            <h2>Import Encrypted Backup</h2>
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
                toast('Backup restored successfully');
                render(root);
              } catch {
                toast('Wrong passphrase or corrupted backup');
              }
            };
          });
          return;
        }
        await store.importAll(text);
        toast('Backup imported successfully');
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
      toast('Person added');
      render(root);
    };
  }
}
