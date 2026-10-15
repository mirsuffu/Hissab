// Simple 1:1 chat (UPI-style). Zero-cost architecture: documents and markdown sent directly via Firestore.
import * as cloud from '../core/cloud.js';
import { renderMarkdown, csvToMarkdown } from '../core/markdown.js';
import { download, printHTML } from '../core/export.js';
import { esc, toast, confirmModal } from '../ui.js';

let stop = [];
const clean = () => { stop.forEach(f => f()); stop = []; };
const size = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const time = ts => { const d = new Date(ts); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
const note = (title, body, extra = '') => `<header class="top"><h1>Chat</h1></header><section class="card glass form"><h2>${title}</h2><p class="muted">${body}</p>${extra}</section>`;

export async function render(root, arg) {
  clean();
  if (!cloud.configured()) { root.innerHTML = note('Not connected', 'Chat needs a Firebase project. Add its web config in <b>js/firebase-config.js</b> and set up the rules from <b>docs/CHAT_SPEC.md</b>.'); return; }
  if (!cloud.state().ready) { root.innerHTML = '<p class="muted">Connecting…</p>'; try { await cloud.init(); } catch (e) { root.innerHTML = note('Couldn’t connect', esc(String(e.message || e))); return; } }
  const st = cloud.state();
  if (!st.user) {
    root.innerHTML = note('Sign in to chat', 'Your account keeps your ID the same on every device.', '<div><button class="btn primary" data-signin>Sign in with Google</button></div>');
    root.onclick = async e => { if (e.target.closest('[data-signin]')) try { await cloud.signIn(); } catch (err) { toast(err.message || 'Sign-in failed'); } };
    return;
  }
  if (!st.profile) { claim(root, st.user); return; }
  arg ? thread(root, arg) : list(root);
}

function claim(root, user) {
  root.innerHTML = note('Choose your ID', 'People find you by this ID. Letters, numbers, dot and underscore, 3–20 characters. It can’t be changed later.', `
    <form id="cf" class="form"><label class="field"><span>Display name</span><input name="name" required value="${esc(user.displayName || '')}"></label>
    <label class="field"><span>Unique ID</span><input name="handle" required autocomplete="off" autocapitalize="none" spellcheck="false"></label><button class="btn primary">Continue</button></form>`);
  root.querySelector('#cf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await cloud.claimHandle(f.get('handle'), f.get('name')); } catch (err) { toast(err.message); }
  };
}

function list(root) {
  const me = cloud.state().user.uid;
  root.innerHTML = `<header class="top"><div><h1>Chat</h1><p class="muted">@${esc(cloud.state().profile.handle)}</p></div></header>
    <form id="sf" class="row"><label class="field" style="flex:1"><input name="q" placeholder="Find by ID or name" autocomplete="off" aria-label="Find people"></label><button class="btn">Search</button></form>
    <div id="results" class="rows"></div><div id="chats" class="rows"></div>`;
  root.querySelector('#sf').onsubmit = async e => {
    e.preventDefault(); const box = root.querySelector('#results'); box.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const r = await cloud.search(new FormData(e.target).get('q'));
      box.innerHTML = r.map(u => `<a class="row-item" href="#/chat/${u.uid}">${esc(u.name)}<small>@${esc(u.handle)}</small></a>`).join('') || '<div class="empty glass">No one found. Check the ID, or they may not be discoverable by name.</div>';
    } catch (err) { box.innerHTML = ''; toast(err.message || 'Search failed'); }
  };
  stop.push(cloud.watchChats(chats => {
    root.querySelector('#chats').innerHTML = chats.map(c => {
      const other = c.members.find(m => m !== me), un = c.unread?.[me] || 0;
      const tag = c.status === 'pending' ? (c.requester === me ? 'Waiting' : 'Request') : c.status === 'blocked' ? 'Blocked' : '';
      return `<a class="row-item" href="#/chat/${other}"><span><b>${esc(c.names?.[other] || 'Unknown')}</b> ${tag ? `<span class="chip">${tag}</span>` : ''}<small>${esc(c.lastMessage?.text || '')}</small></span><span class="amt">${un ? `<span class="badge">${un}</span>` : `<small>${time(c.updatedAt)}</small>`}</span></a>`;
    }).join('') || '<div class="empty glass">No chats yet. Search for someone above.</div>';
  }));
}

function docIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(ext)) return '📊';
  if (['json', 'md', 'txt'].includes(ext)) return '📄';
  if (['doc', 'docx', 'pdf'].includes(ext)) return '📑';
  return '📎';
}

function renderTicks(m, mineMsg, chat, otherUid) {
  if (!mineMsg) return '';
  if (!chat) return '<span class="msg-ticks sent" title="Sent">✓</span>';
  const unreadOther = chat.unread?.[otherUid] || 0;
  if (unreadOther === 0) {
    return '<span class="msg-ticks read" title="Read">✓✓</span>';
  }
  return '<span class="msg-ticks delivered" title="Delivered">✓✓</span>';
}

async function thread(root, otherUid) {
  const me = cloud.state().user.uid, id = cloud.chatId(me, otherUid);
  let other; try { other = await cloud.getUser(otherUid); } catch { other = null; }
  if (!other) { toast('That person could not be found'); location.hash = '#/chat'; return; }
  let chat = null, docPayload = null, currentMsgs = [];

  root.innerHTML = `
    <div class="chat-thread-card glass">
      <header class="chat-thread-header">
        <div class="chat-thread-user">
          <a class="chat-back-btn" href="#/chat" title="Back to Chats">‹</a>
          <div>
            <h1 class="chat-thread-name">${esc(other.name)}</h1>
            <p class="muted chat-thread-handle">@${esc(other.handle)}</p>
          </div>
        </div>
        <button class="btn" data-block>Block</button>
      </header>
      <div id="banner" class="chat-banner" hidden></div>
      <div id="msgs" class="chat-thread-msgs"></div>
      <div class="chat-composer-wrap">
        <p id="chip" class="chat-attach-chip" hidden></p>
        <form id="mf" class="composer glass">
          <input type="file" hidden id="pick" accept=".csv,.tsv,.txt,.md,.json,.doc,.xls,.html">
          <button type="button" class="btn" data-attach aria-label="Attach document" title="Attach CSV, statement or document">＋</button>
          <input name="text" placeholder="Message" autocomplete="off" aria-label="Message">
          <button class="btn primary">Send</button>
        </form>
      </div>
    </div>`;

  const $ = s => root.querySelector(s);
  const banner = () => {
    const b = $('#banner'), mine = chat?.requester === me;
    if (!b) return;
    const content = !chat ? '<p class="muted">Your first message is sent as a request. They need to accept before you can continue.</p>'
      : chat.status === 'pending' && !mine ? '<div class="card glass stack" style="margin:4px 0"><b>Message request</b><div class="row"><button class="btn primary" data-accept>Accept</button><button class="btn danger" data-decline>Block</button></div></div>'
      : chat.status === 'pending' ? '<p class="muted">Waiting for them to accept your request.</p>'
      : chat.status === 'blocked' ? `<p class="muted">Blocked.</p>${chat.blockedBy === me ? '<button class="btn" data-unblock>Unblock</button>' : ''}` : '';
    b.innerHTML = content;
    b.hidden = !content;
    const blockBtn = $('[data-block]');
    if (blockBtn) blockBtn.hidden = chat?.status === 'blocked';
  };
  banner();

  const renderMessages = () => {
    const box = $('#msgs');
    if (!box) return;
    box.innerHTML = currentMsgs.map(m => {
      const mineMsg = m.from === me;
      let docHtml = '';
      if (m.doc) {
        docHtml = `
          <div class="msg-doc-card">
            <div class="msg-doc-left">
              <span class="msg-doc-icon">${docIcon(m.doc.name)}</span>
              <div class="msg-doc-details">
                <span class="msg-doc-name" title="${esc(m.doc.name)}">${esc(m.doc.name)}</span>
                <span class="msg-doc-size">${size(m.doc.size || m.doc.content?.length || 0)}</span>
              </div>
            </div>
            <div class="msg-doc-btns">
              <button type="button" class="btn-micro" data-view-doc="${m.id}" title="Preview file">View</button>
              <button type="button" class="btn-micro" data-download-doc="${m.id}" title="Save file">Save</button>
              <button type="button" class="btn-micro" data-copy-doc="${m.id}" title="Copy text">Copy</button>
            </div>
          </div>`;
      }
      const textHtml = m.text ? `<div class="msg-text">${renderMarkdown(m.text)}</div>` : '';
      const ticks = renderTicks(m, mineMsg, chat, otherUid);
      return `
        <div class="msg ${mineMsg ? 'me' : 'them'}">
          ${docHtml}
          ${textHtml}
          <div class="msg-time-row">
            <small>${time(m.ts)}</small>
            ${ticks}
          </div>
        </div>`;
    }).join('') || '<div class="empty glass">Say hello 👋</div>';
  };

  stop.push(cloud.watchChat(id, c => {
    chat = c;
    banner();
    if (currentMsgs.length) renderMessages();
  }));

  stop.push(cloud.watchMessages(id, msgs => {
    currentMsgs = msgs;
    renderMessages();
    const box = $('#msgs');
    if (box) box.scrollTop = box.scrollHeight;
    if (msgs.some(m => m.from !== me)) cloud.markRead(id);
  }));

  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-attach]')) $('#pick').click();
      else if (t.closest('[data-accept]')) await cloud.respond(id, true);
      else if (t.closest('[data-decline]')) await cloud.respond(id, false);
      else if (t.closest('[data-block]')) {
        const ok = await confirmModal({
          title: `Block ${other.name}?`,
          message: `Block ${other.name}? They won’t be able to message you.`,
          confirmText: 'Block',
          danger: true
        });
        if (ok) await cloud.block(id);
      }
      else if (t.closest('[data-unblock]')) await cloud.unblock(id);
      else if (t.closest('[data-copy-doc]')) {
        const mid = t.closest('[data-copy-doc]').dataset.copyDoc;
        const msg = currentMsgs.find(m => m.id === mid);
        if (msg?.doc?.content) { await navigator.clipboard?.writeText(msg.doc.content); toast('Document copied'); }
      }
      else if (t.closest('[data-download-doc]')) {
        const mid = t.closest('[data-download-doc]').dataset.downloadDoc;
        const msg = currentMsgs.find(m => m.id === mid);
        if (msg?.doc) download(msg.doc.name, msg.doc.type || 'text/plain', msg.doc.content);
      }
      else if (t.closest('[data-view-doc]')) {
        const mid = t.closest('[data-view-doc]').dataset.viewDoc;
        const msg = currentMsgs.find(m => m.id === mid);
        if (msg?.doc) {
          const isCsv = msg.doc.name.endsWith('.csv') || msg.doc.name.endsWith('.tsv') || msg.doc.type === 'text/csv';
          const formatted = isCsv ? csvToMarkdown(msg.doc.content) : msg.doc.content;
          openSheet(`
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">
              <div>
                <h2 style="margin:0;font-size:1.15rem">${esc(msg.doc.name)}</h2>
                <small class="muted">${size(msg.doc.size || msg.doc.content.length)}</small>
              </div>
              <div style="display:flex;gap:6px">
                <button type="button" class="btn-micro" data-download-doc="${msg.id}">Save</button>
                <button type="button" class="btn-micro" data-print-doc="${msg.id}">Print</button>
              </div>
            </div>
            <div style="max-height:65dvh;overflow-y:auto;padding:12px;background:rgba(0,0,0,.08);border-radius:var(--radius)">
              ${renderMarkdown(formatted)}
            </div>
          `);
        }
      }
      else if (t.closest('[data-print-doc]')) {
        const mid = t.closest('[data-print-doc]').dataset.printDoc;
        const msg = currentMsgs.find(m => m.id === mid);
        if (msg?.doc) {
          const isCsv = msg.doc.name.endsWith('.csv') || msg.doc.name.endsWith('.tsv') || msg.doc.type === 'text/csv';
          const content = isCsv ? csvToMarkdown(msg.doc.content) : msg.doc.content;
          const html = `<!doctype html><meta charset="utf-8"><title>${esc(msg.doc.name)}</title>
            <style>body{font:14px system-ui,sans-serif;margin:32px;color:#1c2430}table{border-collapse:collapse;width:100%;margin-top:16px}th{background:#2f9e7a;color:#fff;text-align:left;padding:8px 10px}td{border-bottom:1px solid #e6eaee;padding:8px 10px}</style>
            <h1>${esc(msg.doc.name)}</h1>${renderMarkdown(content)}`;
          printHTML(html);
        }
      }
    } catch (err) { toast(err.message || 'Something went wrong'); }
  };

  $('#pick').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const bad = cloud.validateDoc(f); if (bad) return toast(bad);
    try {
      const content = await f.text();
      docPayload = { name: f.name, type: f.type || 'text/plain', size: f.size, content };
      const c = $('#chip'); c.hidden = false;
      c.textContent = `📄 ${f.name} (${size(f.size)}) — tap Send`;
    } catch {
      toast('Could not read document');
    }
  };

  $('#mf').onsubmit = async e => {
    e.preventDefault(); const input = e.target.text, btn = e.target.querySelector('.primary'); btn.disabled = true;
    try {
      await cloud.send(other, input.value, docPayload);
      input.value = ''; docPayload = null; $('#chip').hidden = true;
    } catch (err) { toast(err.message || 'Couldn’t send'); }
    btn.disabled = false;
  };
}

