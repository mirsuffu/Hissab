# Hisaab — income, expense & fund tracker

Minimal, offline-first, family-scale. Plain HTML/CSS/JS (ES modules), no build step.
Look: neumorphic surfaces + glass layers, all driven by CSS variables the user can tweak in Settings.

## Run
    npx serve .        # or: python3 -m http.server   (ES modules need http, not file://)

## Concepts
- **Fund** = a pot of money with a purpose. Types: Yours, Goals, Investments (balance only), Held for others.
- **Entry** = money in or out of one fund. Stored in paise (integers).
- **Gain/Loss** = surplus or deficit this month across *your* funds. Held money is excluded.
- **Held funds** track received vs spent for someone else; "Copy statement" gives a shareable summary.
- **Modes**: Minimal (amount, fund, note) and Detailed (+ categories, dates, meters, filters, full theme controls). Elements tagged `.d-only` show only in Detailed.
- **Deletes are prospective**: deleting a fund, category or party flags it; old entries still show it exactly as before. It just disappears from pickers. Rename updates old entries; delete does not.
- **Parties**: optional who-from/who-to on an entry (Detailed). Category defaults to *General*, date to today.
- **Audit trail** (`#/audit`): append-only record of every data change (who, when, before → after). Synced, not editable.
- **Logs** (`#/logs`): app events and errors on this device, last 2,000 kept, exportable.
- **Person** = separate profile with its own funds (family members on one device/household).

## Structure
    index.html
    css/tokens.css       colours, radius, blur, depth, spacing (themes: mist / ink)
    css/base.css         reset, layout, backdrop
    css/components.css   glass, raised/inset, buttons, forms, nav, sheet
    js/config.js         app name, currency, fund types, default categories
    js/main.js           router + nav (one line per new module)
    js/ui.js             helpers: sheet, toast, icons, escaping
    js/core/models.js    money helpers + record factories
    js/core/calc.js      balances, surplus/deficit, progress meters
    js/core/db.js        IndexedDB (source of truth, works offline)
    js/core/store.js     state + actions (persist -> queue sync -> re-render)
    js/core/sync.js      outbox + last-write-wins merge, backend-agnostic
    js/core/cloud.js     Firebase: sign-in, ID, search, chat, attachments, sync adapter
    js/core/insights.js  alerts, forecast, unusual spends
    js/core/recurring.js, crypto.js, lock.js, export.js
    js/firebase-config.js  your Firebase web config (null until you add it)
    docs/CHAT_SPEC.md    data model + security rules to implement
    js/core/prefs.js     user appearance settings -> CSS variables
    js/core/log.js       device-local app logs
    js/modules/          dashboard, funds, history, settings, txn-sheet, manage, audit, logs

## Also included
- Statements (`#/statements`): any period, filters, field picker, group/sort, presets; PDF, Excel, Word, CSV, TXT, image.
- Transfers between funds ("Move" in the entry sheet) are neutral: they never count as income or spending.
- Recurring entries, budget alerts, spending forecast, unusual-spend flags, category bars (Detailed).
- Encrypted backups (passphrase, AES-GCM) and a PIN lock.
- Google sign-in, cloud sync of your data, and simple 1:1 chat with attachments. Needs Firebase: see **docs/CHAT_SPEC.md**.

## Ship to devices (same code)
- Android: Capacitor  → `npm i @capacitor/core @capacitor/cli @capacitor/android && npx cap init && npx cap add android`
- Desktop: Tauri (small) or Electron, pointing at this folder.
- Bundle Firebase + fonts locally for the wrapped apps instead of CDN.

## Before real use
1. Firebase: fill js/firebase-config.js and implement the rules in docs/CHAT_SPEC.md. Do not ship open rules.
2. Add a service worker + manifest/icons if you also want PWA install.
3. Roadmap: transfers between funds, recurring entries, category budgets, charts, PIN/biometric lock.
