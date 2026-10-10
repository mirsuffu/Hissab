// Interactive slide-over chat interface for the Hisaab AI Financial Co-Pilot
import { askAi, getAiConfig } from '../core/ai.js';
import { renderMarkdown } from '../core/markdown.js';
import { store } from '../core/store.js';
import { fmt } from '../core/models.js';
import { openSheet, closeSheet, esc, icon, toast } from '../ui.js';

const SESSIONS_KEY = 'hisaab.ai_sessions';

const defaultGreeting = () => ({
  role: 'assistant',
  text: `Hey! I'm **Munimji**, your Hisaab Financial Co-Pilot. Ask me about balances, monthly trends, budget alerts, or type *"Spent 250 on tea from Cash"* to log an entry. How can I help?`
});

let conversation = [defaultGreeting()];

const getSessions = () => {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch { return []; }
};

const saveCurrentSession = () => {
  if (conversation.length <= 1) return;
  const sessions = getSessions();
  const title = conversation.find(m => m.role === 'user')?.text?.slice(0, 36) || 'Financial Chat';
  const newSession = { id: Date.now(), title, date: new Date().toLocaleDateString(), msgs: conversation };
  localStorage.setItem(SESSIONS_KEY, JSON.stringify([newSession, ...sessions.slice(0, 9)]));
};

export function openAiAssistant() {
  const cfg = getAiConfig();
  if (!cfg.enabled) {
    return toast('AI services are disabled in Settings');
  }

  const providerBadge = cfg.provider === 'local' || !cfg.apiKey 
    ? 'Local' 
    : (cfg.provider === 'gemini' ? 'Gemini' : (cfg.provider === 'openrouter' ? 'OpenRouter' : 'Custom'));

  openSheet(`
    <div class="ai-sheet">
      <div class="ai-header">
        <div class="ai-brand">
          <span class="ai-sparkle">${icon('ai')}</span>
          <div class="ai-title-wrap">
            <span class="ai-name">Munimji</span>
            <span class="ai-badge">${esc(providerBadge)}</span>
          </div>
        </div>
        <div class="ai-actions">
          <button class="ai-action-btn" id="ai-new" title="Start fresh conversation">${icon('plus')}<span>New</span></button>
          <button class="ai-action-btn icon-only" id="ai-history" title="View previous chats" aria-label="History">${icon('history')}</button>
          <a class="ai-action-btn icon-only" href="#/settings" data-close title="Configure Provider" aria-label="Settings">${icon('gear')}</a>
          <button class="ai-action-btn icon-only" data-close title="Close chat" aria-label="Close">${icon('x')}</button>
        </div>
      </div>

      <div class="ai-preset-wrap">
        <select id="ai-preset-select" class="ai-preset-select" aria-label="Quick Prompts">
          <option value="" disabled selected>⚡ Quick Insights & Prompts…</option>
          <option value="How much money do I have across my funds?">💰 Total Balance & Fund Balances</option>
          <option value="How are my savings and expenses looking this month?">📊 Monthly Summary (In vs Out)</option>
          <option value="Do I have any budget alerts or unusual spends?">⚠️ Budget & Unusual Spends</option>
          <option value="Where am I spending the most money?">🏷️ Top Expense Categories</option>
          <option value="Give me a sharp first-principles financial tip.">💡 First-Principles Accounting Tip</option>
          <option value="Summary of recent transactions">📝 Recent Activity Recap</option>
        </select>
      </div>

      <div id="ai-msgs" class="ai-msgs thread"></div>

      <form id="ai-form" class="ai-composer glass">
        <input name="prompt" placeholder="Ask question or type 'Spent 250 on tea'…" autocomplete="off" required>
        <button class="btn primary" type="submit">Ask</button>
      </form>
    </div>
  `, el => {
    const box = el.querySelector('#ai-msgs');
    const form = el.querySelector('#ai-form');

    const renderCardOrText = m => {
      if (m.role === 'user') return renderMarkdown(m.text);

      // Check if response contains ACTION:create_txn:{...}
      const actionMatch = m.text.match(/ACTION:create_txn:(\{.*?\})/);
      if (!actionMatch) return renderMarkdown(m.text);

      let draft = null;
      try { draft = JSON.parse(actionMatch[1]); } catch {}
      const cleanText = m.text.replace(/ACTION:create_txn:(\{.*?\})/, '').trim();

      let cardHtml = '';
      if (draft && !m.approved && !m.denied) {
        cardHtml = `
          <div class="ai-confirm-card" data-action-id="${m.id || Date.now()}">
            <div class="ai-confirm-hdr">Confirm Entry</div>
            <div class="ai-confirm-grid">
              <span>Type:</span> <b class="${draft.type === 'in' ? 'pos' : 'neg'}">${draft.type === 'in' ? 'Received (Income)' : 'Spent (Expense)'}</b>
              <span>Amount:</span> <b>${fmt(draft.amount)}</b>
              <span>Fund:</span> <b>${esc(draft.fundName)}</b>
              <span>Category:</span> <b>${esc(draft.categoryName || 'General')}</b>
              <span>Note:</span> <b>${esc(draft.note || 'None')}</b>
            </div>
            <div class="ai-confirm-actions">
              <button class="ai-btn-approve" data-approve>Approve & Save</button>
              <button class="ai-btn-deny" data-deny>Deny</button>
            </div>
          </div>
        `;
      } else if (m.approved) {
        cardHtml = `<div class="ai-confirm-done">✓ Saved to accounts (${fmt(draft.amount)} ${draft.type === 'in' ? 'Received' : 'Spent'})</div>`;
      } else if (m.denied) {
        cardHtml = `<div class="ai-confirm-done" style="color:var(--ink-2);background:rgba(0,0,0,.06)">✕ Entry cancelled</div>`;
      }

      return (cleanText ? `<div class="md-p">${renderMarkdown(cleanText)}</div>` : '') + cardHtml;
    };

    const renderMsgs = () => {
      box.innerHTML = conversation.map((m, idx) => `
        <div class="msg ${m.role === 'user' ? 'me' : 'them'} ai-msg" data-msg-idx="${idx}">
          <div class="msg-text">${renderCardOrText(m)}</div>
        </div>
      `).join('');
      box.lastElementChild?.scrollIntoView({ block: 'end' });
    };

    renderMsgs();

    const sendQuery = async q => {
      if (!q.trim()) return;
      conversation.push({ role: 'user', text: q });
      conversation.push({ role: 'assistant', text: 'Thinking…' });
      renderMsgs();

      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const reply = await askAi(q);
        conversation[conversation.length - 1] = { role: 'assistant', text: reply, id: Date.now() };
      } catch (err) {
        conversation[conversation.length - 1] = { role: 'assistant', text: `Error: ${err.message || 'Could not get response'}` };
      }
      btn.disabled = false;
      renderMsgs();
      saveCurrentSession();
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const input = form.prompt;
      const text = input.value;
      input.value = '';
      await sendQuery(text);
    };

    const presetSelect = el.querySelector('#ai-preset-select');
    if (presetSelect) {
      presetSelect.onchange = () => {
        const q = presetSelect.value;
        if (!q) return;
        presetSelect.selectedIndex = 0;
        sendQuery(q);
      };
    }

    // Handle interactive Approve and Deny button clicks
    box.onclick = async e => {
      const appBtn = e.target.closest('[data-approve]');
      const denyBtn = e.target.closest('[data-deny]');
      if (!appBtn && !denyBtn) return;

      const msgEl = e.target.closest('[data-msg-idx]');
      if (!msgEl) return;
      const idx = Number(msgEl.dataset.msgIdx);
      const msg = conversation[idx];
      if (!msg) return;

      const actionMatch = msg.text.match(/ACTION:create_txn:(\{.*?\})/);
      if (!actionMatch) return;
      const draft = JSON.parse(actionMatch[1]);

      if (appBtn) {
        await store.saveTxn({
          type: draft.type,
          amount: draft.amount,
          fundId: draft.fundId,
          categoryId: draft.categoryId,
          partyId: draft.partyId || '',
          date: draft.date || new Date().toISOString().slice(0, 10),
          note: draft.note || ''
        });
        msg.approved = true;
        toast('Entry recorded in accounts');
      } else if (denyBtn) {
        msg.denied = true;
        toast('Entry cancelled');
      }

      renderMsgs();
      saveCurrentSession();
    };

    // New Chat button
    el.querySelector('#ai-new').onclick = () => {
      saveCurrentSession();
      conversation = [defaultGreeting()];
      renderMsgs();
      toast('Started fresh chat');
    };

    // History button
    el.querySelector('#ai-history').onclick = () => {
      const sessions = getSessions();
      if (!sessions.length) return toast('No previous chats found');
      const listHtml = sessions.map((s, i) => `
        <button class="row-item" data-session="${i}">
          <span>${esc(s.title)}<small>${esc(s.date)}</small></span>
          <small>Open</small>
        </button>
      `).join('');

      box.innerHTML = `
        <div class="card glass" style="margin-bottom:12px">
          <div class="top"><b>Chat History</b><button class="btn-micro" id="ai-back-chat">Back to Chat</button></div>
          <div class="rows" style="margin-top:10px">${listHtml}</div>
        </div>
      `;

      box.querySelector('#ai-back-chat').onclick = renderMsgs;
      box.querySelectorAll('[data-session]').forEach(b => {
        b.onclick = () => {
          const s = sessions[Number(b.dataset.session)];
          if (s?.msgs) {
            conversation = s.msgs;
            renderMsgs();
            toast('Chat restored');
          }
        };
      });
    };
  });
}
