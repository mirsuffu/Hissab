// Conversational financial personality assistant & Help Desk for Hisaab.
// Runs locally by default (offline, zero-cost) or integrates with custom AI providers (Gemini, OpenRouter, Custom).
import { store } from './store.js';
import { fmt, toMinor, fromMinor, today, uid } from './models.js';
import { monthRange, summary, fundBalance } from './calc.js';
import { alerts, forecast, byCategory } from './insights.js';
import * as cloud from './cloud.js';
import { sync } from './sync.js';

const AI_CONFIG_KEY = 'hisaab.ai_config';

export function getAiConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null');
    return {
      enabled: cfg?.enabled ?? true,
      provider: cfg?.provider || 'local',
      apiKey: cfg?.apiKey || '',
      endpoint: cfg?.endpoint || '',
      model: cfg?.model || '',
      systemPrompt: cfg?.systemPrompt || ''
    };
  } catch {
    return { enabled: true, provider: 'local', apiKey: '', endpoint: '', model: '', systemPrompt: '' };
  }
}

export function saveAiConfig(cfg) {
  const cur = getAiConfig();
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...cur, ...cfg }));
}

// Generate real-time comprehensive snapshot of the user's financial state & app context
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
  const cloudSt = cloud.state();

  return {
    profile: L.profile?.name || 'Me',
    signInStatus: cloudSt.user ? `Signed in (${cloudSt.user.displayName || cloudSt.user.email})` : 'Guest / Local Account',
    online: navigator.onLine,
    syncStatus: sync.status(),
    totalOwn: fmt(totalOwn),
    totalOwnPaise: totalOwn,
    totalHeld: fmt(totalHeld),
    monthIncome: fmt(s.income),
    monthExpense: fmt(s.expense),
    netSavings: fmt(s.net),
    isSaved: s.net >= 0,
    forecastProjected: fmt(fc.projected),
    forecastAvg: fmt(fc.avg),
    allFundsList: L.funds.map(f => ({ id: f.id, name: f.name, type: f.type, balance: fmt(fundBalance(f, L.txns)), balPaise: fundBalance(f, L.txns) })),
    fundsSummary: ownFunds.map(f => `${f.name}: ${fmt(fundBalance(f, L.txns))}`).join(', '),
    heldSummary: heldFunds.map(f => `${f.name} (for ${f.holder || 'someone'}): ${fmt(fundBalance(f, L.txns))}`).join(', '),
    categories: L.categories.map(c => c.name),
    parties: L.parties.map(p => p.name),
    alerts: al.map(x => x.text),
    topCategories: cats.map(c => `${c.name}: ${fmt(c.amount)}`).join(', '),
    recentTxns: L.txns.slice(-8).reverse().map(t => {
      const f = L.allFunds.find(x => x.id === t.fundId)?.name || 'Fund';
      const c = L.allCategories.find(x => x.id === t.categoryId)?.name || 'General';
      return `${t.date}: ${t.type === 'in' ? '+' : '-'}${fmt(t.amount)} [${f}] (${c}${t.note ? ' · ' + t.note : ''})`;
    })
  };
}

// Built-in intelligent local conversational assistant with accounting guardrails and natural language entry drafting
function localAssistantReply(prompt) {
  const ctx = getFinancialContext();
  const q = prompt.toLowerCase().trim();

  // Guardrail 1: Refuse non-financial / non-app questions
  const nonFinanceKeywords = ['weather', 'movie', 'song', 'football', 'cricket', 'president', 'capital of', 'poem', 'joke', 'recipe', 'game'];
  if (nonFinanceKeywords.some(w => q.includes(w)) && !q.includes('money') && !q.includes('spend') && !q.includes('hisaab')) {
    return `I am dedicated exclusively to your **Hisaab financial accounts and bookkeeping**. I'm unable to assist with non-financial topics. How can I help with your funds or expenses today?`;
  }

  // Guardrail 2: Refuse direct speculative investment decisions
  if ((q.includes('should i buy') || q.includes('which stock') || q.includes('crypto') || q.includes('share price') || q.includes('multibagger')) &&
      (q.includes('invest') || q.includes('stock') || q.includes('trade') || q.includes('buy') || q.includes('coin'))) {
    return `I cannot provide direct investment advice, buy/sell calls, or speculative asset recommendations.\n\n*First Principle:* Prioritize paying down high-cost debt and building an emergency liquid buffer (at least 3 months of expenses) before committing capital to risk assets. Please consult a licensed SEBI registered financial advisor for personalized investment planning.`;
  }

  // 3. Natural Language Transaction Creation
  const isEntryIntent = q.startsWith('spent ') || q.startsWith('spend ') || q.startsWith('paid ') ||
                        q.startsWith('received ') || q.startsWith('got ') || q.startsWith('add entry') ||
                        q.startsWith('record ') || q.startsWith('log ');

  if (isEntryIntent) {
    const L = store.live();
    const amtMatch = prompt.match(/(?:(?:rs\.?|inr|₹)\s*)?(\d+(?:\.\d{1,2})?)/i);
    const amountNum = amtMatch ? parseFloat(amtMatch[1]) : 0;
    const type = (q.includes('received') || q.includes('got') || q.includes('income')) ? 'in' : 'out';

    if (!amountNum || amountNum <= 0) {
      return `How much was the amount? Please specify an amount (e.g., *"Spent 350 on petrol from Wallet"*).`;
    }

    let targetFund = null;
    for (const f of L.funds) {
      if (q.includes(f.name.toLowerCase())) { targetFund = f; break; }
    }

    if (!targetFund && L.funds.length > 1) {
      const fundNames = L.funds.map(f => `\`${f.name}\``).join(', ');
      return `I see you want to record ${type === 'in' ? 'receiving' : 'spending'} **₹${amountNum}**. Which fund should this come from? Available funds: ${fundNames}.`;
    } else if (!targetFund && L.funds.length === 1) {
      targetFund = L.funds[0];
    } else if (!targetFund) {
      return `You don't have any active funds created yet. Please create a fund first in the Funds tab.`;
    }

    let targetCat = L.categories.find(c => q.includes(c.name.toLowerCase())) || L.categories.find(c => c.name === 'General') || L.categories[0];
    const note = prompt.replace(/(?:spent|spend|paid|received|got|add entry|record|log)\s+/i, '').trim();

    const draft = {
      type,
      amount: toMinor(amountNum),
      fundId: targetFund.id,
      fundName: targetFund.name,
      categoryId: targetCat?.id || '',
      categoryName: targetCat?.name || 'General',
      date: today(),
      note: note.slice(0, 60)
    };

    return `I've prepared this transaction for you. Please confirm to record it in your accounts:\n\n` +
      `ACTION:create_txn:${JSON.stringify(draft)}`;
  }

  // 4. Help Desk & System Diagnostics
  if (q.includes('help') || q.includes('how to') || q.includes('diagnos') || q.includes('what is') || q.includes('held for other')) {
    if (q.includes('held for other') || q.includes('held')) {
      return `**Held for Others** is for money you manage on behalf of parents, friends, or roommates. It is tracked in a separate accountable pot so it is **never counted towards your personal savings or net worth**.`;
    }
    if (q.includes('export') || q.includes('statement')) {
      return `To export statements, go to **Statements** (in desktop sidebar or Settings → Statements). You can filter by date, fund, category, and export to **PDF, Excel, Word, CSV, or PNG Image**.`;
    }
    if (q.includes('sync') || q.includes('offline') || q.includes('diagnos')) {
      return `**App Diagnostics:**\n` +
        `- **Account:** ${ctx.signInStatus}\n` +
        `- **Connectivity:** ${ctx.online ? 'Online 🟢' : 'Offline 🔴'}\n` +
        `- **Sync Engine:** ${ctx.syncStatus}\n` +
        `- **Active Funds:** ${ctx.allFundsList.length} funds recorded locally\n` +
        `All your data is stored in your device's IndexedDB and is 100% functional offline at zero cost.`;
    }
    return `**Hisaab Help Desk:**\n` +
      `- **Log Entries:** Tap the **+** button at the bottom (or on desktop bottom-left), or tell me *"Spent 250 on tea from Cash"*.\n` +
      `- **Funds:** Each fund is a purposeful pot (Own, Goal, or Held for someone).\n` +
      `- **Export:** Export clean ledgers in PDF, Excel, Word, or image.\n` +
      `- **Security:** Set a PIN lock or download encrypted backups in **Settings**.`;
  }

  // 5. Balances & Total Money
  if (q.includes('balance') || q.includes('how much') || q.includes('total') || q.includes('net worth') || q.includes('money')) {
    let reply = `You currently have **${ctx.totalOwn}** across your personal funds (${ctx.fundsSummary || 'no active funds'}).`;
    if (ctx.totalHeld !== '₹0') {
      reply += `\n\nAdditionally, you hold **${ctx.totalHeld}** for others (${ctx.heldSummary}), which is kept strictly sequestered.`;
    }
    return reply;
  }

  // 6. Spending, Income & Monthly Breakdown
  if (q.includes('spend') || q.includes('expense') || q.includes('income') || q.includes('save') || q.includes('saving') || q.includes('month')) {
    const verdict = ctx.isSaved
      ? `You are running a **surplus of ${ctx.netSavings}** so far this month! Excellent discipline.`
      : `You are in a deficit of **${ctx.netSavings}** this month. Keep an eye on non-essential expenditures.`;

    let reply = `**This Month's Numbers:**\n- **Received:** ${ctx.monthIncome}\n- **Spent:** ${ctx.monthExpense}\n- **Verdict:** ${verdict}`;
    if (ctx.topCategories) {
      reply += `\n\n**Top Categories:**\n${ctx.topCategories}`;
    }
    return reply;
  }

  // 7. Alerts & Budget Health
  if (q.includes('alert') || q.includes('budget') || q.includes('warn') || q.includes('danger') || q.includes('issue')) {
    if (!ctx.alerts.length) {
      return `All clear! 🎯 None of your funds have breached their monthly budget, and there are no unusual spending spikes detected.`;
    }
    return `⚠️ **Heads-Up Alerts:**\n` + ctx.alerts.map(a => `- ${a}`).join('\n') + `\n\n*Rule:* Regular daily leaks deplete funds faster than rare lump sums.`;
  }

  // 8. Financial Tips / CA First Principles
  if (q.includes('tip') || q.includes('advice') || q.includes('rule') || q.includes('ca')) {
    const tips = [
      `**First Principle of Accounting:** Never treat money held on trust as your personal liquidity. Keep a strict mental and physical wall between your own funds and money held for others.`,
      `**Integer Paise Principle:** Floating-point numbers accumulate rounding drift. Always storing integer paise guarantees 100% exact math over thousands of entries.`,
      `**Prospective Archiving:** History is sacred in accounting. When archiving a fund or category, past records remain immutable. Never rewrite history.`,
      `**Emergency Liquidity:** Maintain at least 3 months of typical expenses (${ctx.forecastAvg || 'usual monthly burn'}) in an instant liquid fund before allocating to illiquid assets.`
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  // 9. Recent Entries
  if (q.includes('recent') || q.includes('history') || q.includes('last entry') || q.includes('last transaction')) {
    if (!ctx.recentTxns.length) return `No transactions recorded yet this month.`;
    return `**Recent Entries:**\n` + ctx.recentTxns.map(t => `- ${t}`).join('\n');
  }

  // Fallback
  return `I'm your **Hisaab Financial Assistant**.\n\n` +
    `- **Your Money:** ${ctx.totalOwn}\n` +
    `- **This Month:** In: ${ctx.monthIncome} · Out: ${ctx.monthExpense} (${ctx.isSaved ? 'Saved' : 'Overspent'} ${ctx.netSavings})\n\n` +
    `Ask me about balances, monthly trends, budget alerts, or type *"Spent 250 on lunch from Cash"* to draft an entry.`;
}

// Dispatch to custom AI provider or fallback to local intelligence
export async function askAi(userPrompt) {
  const cfg = getAiConfig();
  if (!cfg.enabled) {
    return `AI services are currently disabled in Settings.`;
  }

  const ctx = getFinancialContext();

  if (cfg.provider === 'local' || !cfg.apiKey) {
    await new Promise(r => setTimeout(r, 220));
    return localAssistantReply(userPrompt);
  }

  const defaultSys = `You are Munimji, the sharp, first-principles financial assistant for Hisaab (a modern expense & fund tracker).
The user values honesty, crisp logic, and zero fluff.
RULES:
1. Be short, crisp, and concise. Never use filler or corporate padding.
2. Refuse non-financial and non-app related topics humbly and directly.
3. Never give direct speculative investment advice or stock picks; provide educational first-principles caveats.
4. If the user wants to log a transaction, extract type ('in' or 'out'), amount (in rupees), fundId, categoryId, note. If fund or amount is ambiguous, ask clarifying questions first. When all details are clear, end response with ACTION:create_txn:{"type":"out","amount":paise,"fundId":"id","fundName":"name","categoryId":"id","categoryName":"name","date":"YYYY-MM-DD","note":"note"}.
5. Use basic Markdown (bold, bullet lists, tables).

CURRENT CONTEXT:
- User: ${ctx.profile} (${ctx.signInStatus})
- Connectivity: ${ctx.online ? 'Online' : 'Offline'}
- Personal Balance: ${ctx.totalOwn} (${ctx.fundsSummary})
- Held For Others: ${ctx.totalHeld} (${ctx.heldSummary})
- This Month: Received ${ctx.monthIncome}, Spent ${ctx.monthExpense}, Net ${ctx.netSavings}
- Categories: ${ctx.categories.join(', ')}
- Available Funds: ${ctx.allFundsList.map(f => `${f.name} (id: ${f.id})`).join(', ')}
- Active Alerts: ${ctx.alerts.join('; ') || 'None'}`;

  const systemPrompt = cfg.systemPrompt?.trim() ? `${defaultSys}\n\nUSER CUSTOM INSTRUCTIONS:\n${cfg.systemPrompt.trim()}` : defaultSys;

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
    return localAssistantReply(userPrompt) + `\n\n*(Custom provider error: ${err.message || 'offline fallback'}.)*`;
  }

  return localAssistantReply(userPrompt);
}
