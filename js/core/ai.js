// Conversational financial personality assistant for Hisaab.
// Runs locally by default (offline, zero-cost) or integrates with custom AI providers (Gemini, OpenRouter, OpenAI).
import { store } from './store.js';
import { fmt } from './models.js';
import { monthRange, summary, fundBalance } from './calc.js';
import { alerts, forecast, byCategory } from './insights.js';

const AI_CONFIG_KEY = 'hisaab.ai_config';

export function getAiConfig() {
  try {
    return JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null') || {
      provider: 'local', // 'local' | 'gemini' | 'openrouter' | 'custom'
      apiKey: '',
      endpoint: '',
      model: ''
    };
  } catch {
    return { provider: 'local', apiKey: '', endpoint: '', model: '' };
  }
}

export function saveAiConfig(cfg) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
}

// Generate real-time snapshot of the user's financial state
export function getFinancialContext() {
  const L = store.live();
  const [a, b] = monthRange();
  const s = summary(L.allFunds, L.txns, a, b);
  const al = alerts(L);
  const fc = forecast(L);
  const cats = byCategory(L);
  const ownFunds = L.funds.filter(f => f.type !== 'held');
  const heldFunds = L.funds.filter(f => f.type === 'held');
  const totalOwn = ownFunds.reduce((tot, f) => tot + fundBalance(f, L.txns), 0);
  const totalHeld = heldFunds.reduce((tot, f) => tot + fundBalance(f, L.txns), 0);

  return {
    profile: L.profile?.name || 'User',
    totalOwn: fmt(totalOwn),
    totalHeld: fmt(totalHeld),
    monthIncome: fmt(s.income),
    monthExpense: fmt(s.expense),
    netSavings: fmt(s.net),
    isSaved: s.net >= 0,
    forecastProjected: fmt(fc.projected),
    forecastAvg: fmt(fc.avg),
    funds: ownFunds.map(f => `${f.name}: ${fmt(fundBalance(f, L.txns))}`).join(', '),
    held: heldFunds.map(f => `${f.name} (for ${f.holder || 'someone'}): ${fmt(fundBalance(f, L.txns))}`).join(', '),
    alerts: al.map(x => x.text),
    topCategories: cats.map(c => `${c.name}: ${fmt(c.amount)}`).join(', ')
  };
}

// Built-in intelligent local conversational assistant (offline & zero cost)
function localAssistantReply(prompt) {
  const ctx = getFinancialContext();
  const q = prompt.toLowerCase().trim();

  // 1. Balance & Total Money
  if (q.includes('balance') || q.includes('how much') || q.includes('total') || q.includes('net worth') || q.includes('money')) {
    let reply = `You currently have **${ctx.totalOwn}** across your own funds (${ctx.funds || 'no active funds'}).`;
    if (ctx.totalHeld !== '₹0') {
      reply += `\n\nAdditionally, you are holding **${ctx.totalHeld}** for others (${ctx.held}), which is properly sequestered and not counted as yours.`;
    }
    return reply;
  }

  // 2. Spending, Income & Savings
  if (q.includes('spend') || q.includes('expense') || q.includes('income') || q.includes('save') || q.includes('saving') || q.includes('month')) {
    const verdict = ctx.isSaved
      ? `You are running a **surplus of ${ctx.netSavings}** so far this month! Excellent discipline.`
      : `You are currently in deficit by **${ctx.netSavings}** this month. Look out for unnecessary discretionary outlays.`;

    let reply = `**This Month's Numbers:**\n- **Received:** ${ctx.monthIncome}\n- **Spent:** ${ctx.monthExpense}\n- **Net Verdict:** ${verdict}`;
    if (ctx.topCategories) {
      reply += `\n\n**Where your money went:**\n${ctx.topCategories}`;
    }
    return reply;
  }

  // 3. Alerts & Budget Health
  if (q.includes('alert') || q.includes('budget') || q.includes('warn') || q.includes('danger') || q.includes('issue')) {
    if (!ctx.alerts.length) {
      return `All clear! 🎯 None of your funds have breached their monthly budget, and there are no unusual spending spikes detected in the last 7 days.`;
    }
    return `⚠️ **Heads-Up Alerts Detected:**\n` + ctx.alerts.map(a => `- ${a}`).join('\n') + `\n\n*First principle:* Cash flow velocity matters more than static balance. Watch funds that are running at a fast daily burn.`;
  }

  // 4. Financial Tips / CA Wisdom
  if (q.includes('tip') || q.includes('advice') || q.includes('guide') || q.includes('rule') || q.includes('ca')) {
    const tips = [
      `**First Principle of Accounting:** Never treat money held on trust as your liquidity. Keep a strict mental and physical wall between your own surplus and funds managed for family or friends.`,
      `**The 30-Day Velocity Rule:** Spending doesn't kill budgets in lumps; it kills them in daily leakage. Tracking paise as integers guarantees zero floating-point drift over thousands of transactions.`,
      `**Prospective Archiving:** In Hisaab, deleting a category or fund never wipes past entries. History is sacred in finance. If you stop using a fund, archive it — never rewrite history.`,
      `**Emergency Buffer:** Aim to keep at least 3 months of typical expenses (${ctx.forecastAvg || 'usual monthly outlay'}) in a zero-risk liquid fund before putting capital into illiquid investments.`
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  // 5. General conversational fallback
  return `I'm your **Hisaab Financial Co-Pilot**. I reason directly from your local accounts.\n\n` +
    `- **Your Money:** ${ctx.totalOwn}\n` +
    `- **This Month:** Received ${ctx.monthIncome} · Spent ${ctx.monthExpense} (${ctx.isSaved ? 'Saved' : 'Overspent'} ${ctx.netSavings})\n` +
    `- **Active Funds:** ${ctx.funds || 'None'}\n\n` +
    `Ask me about your fund balances, spending breakdown, budget alerts, or configure a custom AI model (Gemini / OpenRouter) in **Settings**.`;
}

// Dispatch to custom AI provider or fallback to local intelligence
export async function askAi(userPrompt) {
  const cfg = getAiConfig();
  const ctx = getFinancialContext();

  if (cfg.provider === 'local' || !cfg.apiKey) {
    // Instant local reply
    await new Promise(r => setTimeout(r, 250)); // subtle natural pause
    return localAssistantReply(userPrompt);
  }

  const systemPrompt = `You are the witty, sharp, first-principles financial assistant for Hisaab (a modern expense & fund tracker).
The user is a CA student/vibe-coder who values honesty, crisp logic, and zero fluff.
CURRENT FINANCIAL CONTEXT:
- User: ${ctx.profile}
- Own Funds Balance: ${ctx.totalOwn} (${ctx.funds})
- Held For Others: ${ctx.totalHeld} (${ctx.held})
- This Month Income: ${ctx.monthIncome}, Expense: ${ctx.monthExpense}, Net: ${ctx.netSavings}
- Top Categories: ${ctx.topCategories}
- Active Alerts: ${ctx.alerts.join('; ') || 'None'}
Answer the user's question directly, clearly, with sharp financial reasoning. Be concise and practical.`;

  try {
    if (cfg.provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model || 'gemini-1.5-flash'}:generateContent?key=${cfg.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUser Question: ${userPrompt}` }] }]
        })
      });
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || localAssistantReply(userPrompt);
    }

    if (cfg.provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model || 'google/gemini-2.0-flash-exp:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content || localAssistantReply(userPrompt);
    }

    if (cfg.provider === 'custom') {
      const endpoint = cfg.endpoint.replace(/\/$/, '') + '/chat/completions';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model || 'default',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content || localAssistantReply(userPrompt);
    }
  } catch (err) {
    // If network fails, gracefully answer via local intelligence
    return localAssistantReply(userPrompt) + `\n\n*(Custom provider error: ${err.message || 'offline fallback'}.)*`;
  }

  return localAssistantReply(userPrompt);
}
