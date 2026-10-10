// Simple 1:1 chat (UPI-style). People are found by unique ID or name; strangers must be accepted first. No groups.
import * as cloud from '../core/cloud.js';
import { esc, toast } from '../ui.js';

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

async function thread(root, otherUid) {
  const me = cloud.state().user.uid, id = cloud.chatId(me, otherUid);
  let other; try { other = await cloud.getUser(otherUid); } catch { other = null; }
  if (!other) { toast('That person could not be found'); location.hash = '#/chat'; return; }
  let chat = null, file = null;
  root.innerHTML = `<header class="top"><div><a class="muted" href="#/chat">‹ Chats</a><h1>${esc(other.name)}</h1><p class="muted">@${esc(other.handle)}</p></div><button class="btn" data-block>Block</button></header>
    <div id="banner"></div><div id="msgs" class="thread"></div>
    <form id="mf" class="composer glass"><input type="file" hidden id="pick" accept="image/*,.pdf,.txt,.csv,.docx,.xlsx"><button type="button" class="btn" data-attach aria-label="Attach file">＋</button>
      <input name="text" placeholder="Message" autocomplete="off" aria-label="Message"><button class="btn primary">Send</button></form><p id="chip" class="muted" hidden></p>`;
  const $ = s => root.querySelector(s);
  const banner = () => {
    const b = $('#banner'), mine = chat?.requester === me;
    b.innerHTML = !chat ? '<p class="muted">Your first message is sent as a request. They need to accept before you can continue.</p>'
      : chat.status === 'pending' && !mine ? '<div class="card glass stack"><b>Message request</b><div class="row"><button class="btn primary" data-accept>Accept</button><button class="btn danger" data-decline>Block</button></div></div>'
      : chat.status === 'pending' ? '<p class="muted">Waiting for them to accept your request.</p>'
      : chat.status === 'blocked' ? `<p class="muted">Blocked.</p>${chat.blockedBy === me ? '<button class="btn" data-unblock>Unblock</button>' : ''}` : '';
    $('[data-block]').hidden = chat?.status === 'blocked';
  };
  banner();
  stop.push(cloud.watchChat(id, c => { chat = c; banner(); }));
  stop.push(cloud.watchMessages(id, msgs => {
    const box = $('#msgs');
    box.innerHTML = msgs.map(m => {
      const a = m.attachment, mineMsg = m.from === me;
      const body = a ? (a.type.startsWith('image/') ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>` : `<a class="file" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}<small>${size(a.size)}</small></a>`) : '';
      return `<div class="msg ${mineMsg ? 'me' : 'them'}">${body}${m.text ? `<span>${esc(m.text)}</span>` : ''}<small>${time(m.ts)}</small></div>`;
    }).join('') || '<div class="empty glass">Say hello 👋</div>';
    box.lastElementChild?.scrollIntoView({ block: 'end' });
    if (msgs.some(m => m.from !== me)) cloud.markRead(id);
  }));
  root.onclick = async e => {
    const t = e.target;
    try {
      if (t.closest('[data-attach]')) $('#pick').click();
      else if (t.closest('[data-accept]')) await cloud.respond(id, true);
      else if (t.closest('[data-decline]')) await cloud.respond(id, false);
      else if (t.closest('[data-block]')) { if (confirm(`Block ${other.name}? They won’t be able to message you.`)) await cloud.block(id); }
      else if (t.closest('[data-unblock]')) await cloud.unblock(id);
    } catch (err) { toast(err.message || 'Something went wrong'); }
  };
  $('#pick').onchange = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const bad = cloud.validateFile(f); if (bad) return toast(bad);
    file = f; const c = $('#chip'); c.hidden = false; c.textContent = `📎 ${f.name} (${size(f.size)}) — tap Send`;
  };
  $('#mf').onsubmit = async e => {
    e.preventDefault(); const input = e.target.text, btn = e.target.querySelector('.primary'); btn.disabled = true;
    try { await cloud.send(other, input.value, file); input.value = ''; file = null; $('#chip').hidden = true; }
    catch (err) { toast(err.message || 'Couldn’t send'); }
    btn.disabled = false;
  };
}
