# Hisaab — Feature Backlog & Decision Register

## Accepted
- **[A-01] Upgrade `goal` Fund Type to Pot (Piggy Bank)**: Unified under Pot vehicle with target amount, target date, custody locations (E-Wallet, Physical Cash Box, Bank Deposit, Custom), and dedicated Gullak UI.
- **[A-02] Global Suspense Account (उचंत खाता)**: Persistent system suspense holding account where unreconciled differences or forgotten cash spends are parked (`Dr/Cr Suspense`) without distorting real expense categories, with 1-click reclassification and clean write-offs.
- **[A-03] Bank & Cash Reconciliation (BRS Fast-Audit)**: Fast periodic reconciliation sheet to match actual bank/cash balance with ledger balance, calculate variances, and park unexplained differences into Suspense. Enabled via User Toggle in Settings.
- **[A-04] Pot Discipline Lock & Friction Guard**: Psychological friction mechanism (mandatory confirmation / purpose check / lock) before breaking/withdrawing from a Pot.
- **[A-05] Pot Target Date Velocity & Run-Rate Predictor**: Real-time projection telling user whether current savings pace meets the target deadline and calculating required monthly run-rate.
- **[A-06] Pot 'Chillar Saver' (Round-Up to Nearest Multiple of 5)**: Micro-saving auto-sweep rounding expense transactions up to the nearest multiple of ₹5 (e.g., ₹83 -> ₹85, routing ₹2 into target Pot). Enabled via User Toggle in Settings.

---

## Proposed
*(All proposed items reviewed)*

---

## Rejected
- **[R-01] Replace / Remove `FUND_TYPES.invest`**: Keep `invest` fund type untouched as requested.
- **[R-02] Physical Cash Box Denomination Counter (Gullak Audit)**: Unnecessary complexity / low utility for routine app usage.
