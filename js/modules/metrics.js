// Dedicated Financial Metrics & Ratios Dashboard
// First-principles liquidity analysis, burn velocity, cash runway, and interactive donut charts.
import { store } from '../core/store.js';
import { fundBalance, summary, monthRange } from '../core/calc.js';
import { fmt } from '../core/models.js';
import { forecast, byCategory } from '../core/insights.js';
import { esc, dot } from '../ui.js';

function renderDonut(segments, centerValue, centerLabel, size = 180) {
  const R = 42;
  const C = 2 * Math.PI * R; // ~263.89
  let offset = 0;

  const circles = segments.map((seg, i) => {
    const dash = (seg.pct / 100) * C;
    const currentOffset = offset;
    offset += dash;
    return `<circle r="${R}" cx="60" cy="60" fill="transparent"
      stroke="${seg.color}" stroke-width="15"
      stroke-dasharray="${dash.toFixed(2)} ${C.toFixed(2)}"
      stroke-dashoffset="-${currentOffset.toFixed(2)}"
      transform="rotate(-90 60 60)"
      class="donut-segment"
      data-label="${esc(seg.label)}: ${seg.pct}%">
      <title>${esc(seg.label)}: ${fmt(seg.val)} (${seg.pct}%)</title>
    </circle>`;
  }).join('');

  return `
    <div class="donut-chart-wrap" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 120 120" class="donut-svg">
        <circle r="${R}" cx="60" cy="60" fill="transparent" stroke="rgba(255,255,255,0.06)" stroke-width="15"></circle>
        ${circles}
      </svg>
      <div class="donut-center-info">
        <strong class="donut-val">${esc(centerValue)}</strong>
        <span class="donut-lbl">${esc(centerLabel)}</span>
      </div>
    </div>
  `;
}

export function render(root) {
  const L = store.live();
  const { funds, allFunds, txns } = L;
  const [a, b] = monthRange();
  const s = summary(allFunds, txns, a, b);

  const mine = funds.filter(f => f.type !== 'held');
  const totalLiquid = mine.reduce((sum, f) => sum + Math.max(0, fundBalance(f, txns)), 0);

  // 1. Savings Rate (%) = (Inflow - Outflow) / Inflow * 100
  const savingsRate = s.income > 0 ? Math.round(((s.income - s.expense) / s.income) * 100) : 0;
  const savingsStatus = savingsRate >= 40 ? 'Exceptional' : (savingsRate >= 20 ? 'Healthy' : (savingsRate > 0 ? 'Tight' : 'Deficit'));
  const savingsStatusColor = savingsRate >= 20 ? 'var(--pos)' : (savingsRate > 0 ? 'var(--accent)' : 'var(--neg)');

  // 2. Daily Burn Velocity & Month Projection
  const now = new Date();
  const daysElapsed = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyBurn = Math.round(s.expense / daysElapsed);
  const projectedBurn = dailyBurn * daysInMonth;

  // 3. Cash Runway (Months of Survival without new income)
  const fc = forecast(L);
  const baselineMonthlyExpense = fc.avg > 0 ? fc.avg : (projectedBurn > 0 ? projectedBurn : s.expense);
  const runwayMonths = baselineMonthlyExpense > 0 ? (totalLiquid / baselineMonthlyExpense).toFixed(1) : (totalLiquid > 0 ? '12+' : '0');
  const runwayPct = Math.min(100, Math.max(8, Math.round((Number(runwayMonths) / 12) * 100)));
  const runwayBadge = Number(runwayMonths) >= 6 ? 'Resilient (6m+)' : (Number(runwayMonths) >= 3 ? 'Stable (3-6m)' : 'Vulnerable (<3m)');
  const runwayBadgeColor = Number(runwayMonths) >= 6 ? 'var(--pos)' : (Number(runwayMonths) >= 3 ? 'var(--accent)' : 'var(--neg)');

  // 4. Operating Expense Ratio
  const expenseRatio = s.income > 0 ? Math.min(100, Math.round((s.expense / s.income) * 100)) : (s.expense > 0 ? 100 : 0);

  // Fund Liquidity Donut Segments
  const fundBals = mine.map(f => ({ name: f.name, bal: Math.max(0, fundBalance(f, txns)), hue: f.hue })).filter(f => f.bal > 0);
  const fundTotal = fundBals.reduce((x, f) => x + f.bal, 0) || 1;
  const fundSegments = fundBals.map(f => ({
    label: f.name,
    val: f.bal,
    pct: Math.round((f.bal / fundTotal) * 100),
    color: `hsl(${f.hue} 65% 52%)`
  }));
  if (!fundSegments.length) {
    fundSegments.push({ label: 'No liquid balance', val: 0, pct: 100, color: 'var(--ink-2)' });
  }

  // Category Spend Donut Segments
  const cats = byCategory(L);
  const catTotal = cats.reduce((x, c) => x + c.amount, 0) || 1;
  const catColors = ['hsl(162 65% 50%)', 'hsl(210 75% 55%)', 'hsl(280 65% 55%)', 'hsl(38 85% 50%)', 'hsl(350 75% 55%)', 'hsl(180 50% 45%)'];
  const catSegments = cats.map((c, i) => ({
    label: c.name,
    val: c.amount,
    pct: Math.round((c.amount / catTotal) * 100),
    color: catColors[i % catColors.length]
  }));
  if (!catSegments.length) {
    catSegments.push({ label: 'No expenses this month', val: 0, pct: 100, color: 'var(--ink-2)' });
  }

  root.innerHTML = `
    <header class="top">
      <div>
        <a href="#/home" class="btn-back" style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;font-weight:600;color:var(--ink-2);margin-bottom:6px">
          ← Overview
        </a>
        <h1>Financial Metrics & Ratios</h1>
        <p class="muted">First-principles liquidity, burn velocity, and survivability</p>
      </div>
    </header>

    <!-- Liquid Ratios Summary Grid -->
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      <!-- 1. Operating Savings Rate -->
      <section class="card glass metric-card">
        <div class="top">
          <span class="label">Operating Savings Rate</span>
          <span class="status-pill" style="color:${savingsStatusColor}">${savingsStatus}</span>
        </div>
        <div class="metric-big-row">
          <strong class="big" style="color:${savingsStatusColor}">${savingsRate}%</strong>
          <small class="muted">of monthly inflow retained</small>
        </div>
        <div class="liquid-tank" title="Savings fill: ${Math.max(0, savingsRate)}%">
          <div class="liquid-fill" style="height:${Math.max(6, Math.min(100, savingsRate))}%;background:linear-gradient(180deg, ${savingsStatusColor}, var(--accent))">
            <div class="liquid-wave"></div>
          </div>
        </div>
        <div class="split" style="margin-top:4px">
          <div><span class="label">Received</span><b class="pos">${fmt(s.income)}</b></div>
          <div><span class="label">Spent</span><b>${fmt(s.expense)}</b></div>
          <div><span class="label">Net</span><b class="${s.net >= 0 ? 'pos' : 'neg'}">${fmt(s.net)}</b></div>
        </div>
      </section>

      <!-- 2. Cash Runway Tank -->
      <section class="card glass metric-card">
        <div class="top">
          <span class="label">Cash Runway (Survival)</span>
          <span class="status-pill" style="color:${runwayBadgeColor}">${runwayBadge}</span>
        </div>
        <div class="metric-big-row">
          <strong class="big">${runwayMonths} <span style="font-size:1.1rem;font-weight:600">months</span></strong>
          <small class="muted">at current monthly burn rate</small>
        </div>
        <div class="liquid-tank" title="Runway fuel: ${runwayPct}%">
          <div class="liquid-fill" style="height:${runwayPct}%;background:linear-gradient(180deg, ${runwayBadgeColor}, var(--accent))">
            <div class="liquid-wave"></div>
          </div>
        </div>
        <div class="split" style="margin-top:4px">
          <div><span class="label">Liquid Cash</span><b class="pos">${fmt(totalLiquid)}</b></div>
          <div><span class="label">Monthly Burn</span><b>${fmt(baselineMonthlyExpense)}</b></div>
        </div>
      </section>

      <!-- 3. Burn Velocity Card -->
      <section class="card glass metric-card">
        <div class="top">
          <span class="label">Daily Burn Velocity</span>
          <span class="status-pill">Day ${daysElapsed} / ${daysInMonth}</span>
        </div>
        <div class="metric-big-row">
          <strong class="big">${fmt(dailyBurn)} <span style="font-size:1rem;font-weight:600">/ day</span></strong>
          <small class="muted">projected: ${fmt(projectedBurn)} this month</small>
        </div>
        <div class="pacing-track">
          <div class="pacing-fill" style="width:${Math.min(100, Math.round((daysElapsed / daysInMonth) * 100))}%"></div>
        </div>
        <p class="muted" style="margin-top:6px;font-size:.82rem">
          At this pace, total outflow by month-end will reach <b>${fmt(projectedBurn)}</b>.
        </p>
      </section>

      <!-- 4. Expense Efficiency Ratio -->
      <section class="card glass metric-card">
        <div class="top">
          <span class="label">Cost-to-Income Efficiency</span>
          <span class="status-pill">${expenseRatio < 50 ? 'Low Cost' : (expenseRatio <= 80 ? 'Moderate' : 'High Outflow')}</span>
        </div>
        <div class="metric-big-row">
          <strong class="big" style="color:${expenseRatio > 80 ? 'var(--neg)' : 'var(--ink)'}">${expenseRatio}%</strong>
          <small class="muted">of earnings consumed</small>
        </div>
        <div class="meter inset ${expenseRatio > 80 ? 'over' : ''}" style="height:12px;margin:8px 0">
          <i style="width:${expenseRatio}%;background:${expenseRatio > 80 ? 'var(--neg)' : 'var(--accent)'}"></i>
        </div>
        <p class="muted" style="font-size:.82rem">
          ${expenseRatio <= 50 ? 'Strong surplus buffer. Wealth compounding potential.' : (expenseRatio <= 80 ? 'Balanced lifestyle expenses with positive savings.' : 'High burn rate. Monitor discretionary spending.')}
        </p>
      </section>
    </div>

    <!-- Interactive Charts Section -->
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:10px">
      <!-- Donut 1: Liquidity Distribution by Fund -->
      <section class="card glass stack">
        <div class="top">
          <h2>Fund Liquidity Allocation</h2>
          <span class="label">${fundBals.length} active pots</span>
        </div>
        <div class="donut-flex-container">
          ${renderDonut(fundSegments, fmt(totalLiquid), 'Total Liquid', 160)}
          <div class="donut-legend rows" style="flex:1">
            ${fundSegments.map(s => `
              <div class="donut-legend-item">
                <span class="donut-legend-chip" style="background:${s.color}"></span>
                <span class="donut-legend-label">${esc(s.label)}</span>
                <b class="donut-legend-pct">${s.pct}%</b>
                <span class="donut-legend-amt">${fmt(s.val)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <!-- Donut 2: Category Spend Distribution -->
      <section class="card glass stack">
        <div class="top">
          <h2>Outflow by Category</h2>
          <span class="label">${cats.length} categories</span>
        </div>
        <div class="donut-flex-container">
          ${renderDonut(catSegments, fmt(s.expense), 'This Month', 160)}
          <div class="donut-legend rows" style="flex:1">
            ${catSegments.map(s => `
              <div class="donut-legend-item">
                <span class="donut-legend-chip" style="background:${s.color}"></span>
                <span class="donut-legend-label">${esc(s.label)}</span>
                <b class="donut-legend-pct">${s.pct}%</b>
                <span class="donut-legend-amt">${fmt(s.val)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    </div>
  `;
}
