// Interactive slide-over chat interface for the Hisaab AI Financial Co-Pilot
import { askAi, getAiConfig } from '../core/ai.js';
import { renderMarkdown } from '../core/markdown.js';
import { openSheet, closeSheet, esc, icon } from '../ui.js';

let conversation = [
  {
    role: 'assistant',
    text: `Hey! I'm your **Hisaab Co-Pilot**. Ask me about your current balances, spending breakdown, monthly savings, or budget alerts. How can I help?`
  }
];

export function openAiAssistant() {
  const cfg = getAiConfig();
  const providerLabel = cfg.provider === 'local' || !cfg.apiKey ? 'Local Intelligence' : `${cfg.provider.toUpperCase()} (${cfg.model || 'Default'})`;

  openSheet(`
    <div class="ai-sheet">
      <div class="ai-header">
        <div class="ai-title">
          <span class="ai-sparkle">${icon('ai')}</span>
          <div>
            <h2>Financial Co-Pilot</h2>
            <small class="muted"><span class="status-dot"></span>${providerLabel}</small>
          </div>
        </div>
        <a class="btn-micro" href="#/settings" data-close title="Configure Provider">AI Settings</a>
      </div>

      <div class="ai-quick-prompts">
        <button class="pill-btn" data-q="How much money do I have across my funds?">💰 Total Balance</button>
        <button class="pill-btn" data-q="How are my savings and expenses looking this month?">📊 Monthly Summary</button>
        <button class="pill-btn" data-q="Do I have any budget alerts or unusual spends?">⚠️ Budget Alerts</button>
        <button class="pill-btn" data-q="Give me a sharp first-principles financial tip.">💡 Financial Tip</button>
      </div>

      <div id="ai-msgs" class="ai-msgs thread"></div>

      <form id="ai-form" class="ai-composer glass">
        <input name="prompt" placeholder="Ask about balances, expenses, or advice…" autocomplete="off" required>
        <button class="btn primary" type="submit">Ask</button>
      </form>
    </div>
  `, el => {
    const box = el.querySelector('#ai-msgs');
    const form = el.querySelector('#ai-form');

    const renderMsgs = () => {
      box.innerHTML = conversation.map(m => `
        <div class="msg ${m.role === 'user' ? 'me' : 'them'} ai-msg">
          <div class="msg-text">${renderMarkdown(m.text)}</div>
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
        conversation[conversation.length - 1] = { role: 'assistant', text: reply };
      } catch (err) {
        conversation[conversation.length - 1] = { role: 'assistant', text: `Error: ${err.message || 'Could not get response'}` };
      }
      btn.disabled = false;
      renderMsgs();
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const input = form.prompt;
      const text = input.value;
      input.value = '';
      await sendQuery(text);
    };

    el.querySelectorAll('[data-q]').forEach(btn => {
      btn.onclick = () => sendQuery(btn.dataset.q);
    });
  });
}
