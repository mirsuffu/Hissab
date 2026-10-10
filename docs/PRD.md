# Product Requirements Document — Hisaab

**Status:** v0.1 · build complete, pending first browser run and Firebase setup
**Name:** "Hisaab" is a placeholder (`js/config.js`). Brand, currency and locale are one-line changes.
**Date:** 10 October 2026

---

## 1. Overview

Hisaab is a minimal, modern income/expense and fund-management app for one person and their family. It tracks money in and out across separate **funds**, shows whether you **saved or overspent**, and handles the case most expense apps ignore: **money you hold on someone else's behalf** (for example parents give you money for specific expenses, and you keep an accountable statement of every rupee spent).

It is offline-first, runs on Android and desktop from one HTML/CSS/JS codebase, and has a neumorphic + glassmorphic interface the user can customise. A simple 1:1 chat (UPI-app style) lets people share a statement or a receipt without leaving the app.

### 1.1 Goals
1. Log an entry in seconds (Minimal mode), with depth available when wanted (Detailed mode).
2. Keep your own money and money held for others clearly separate and accountable.
3. Never lose or silently alter history: prospective deletes, an immutable audit trail, exportable statements.
4. Work fully offline; sync to the cloud only if the user opts in.
5. Look distinctive and be customisable by the user (theme, accent, shape, depth, blur, spacing).

### 1.2 Non-goals
- Not commercial, multi-tenant or built for scale. Family-scale only.
- Not a messenger replacement: no groups, calls, statuses or stories.
- No bank/UPI account linking, no live market data, no portfolio analytics.
- No end-to-end encrypted chat in v1 (see §11).
- No ads, analytics or third-party tracking.

### 1.3 Users
- **Primary:** the owner (a student/freelancer managing personal money and money held for family).
- **Secondary:** family members who each get a separate profile on the same device, and people the owner chats with.

---

## 2. Core concepts

| Term | Meaning |
|---|---|
| **Fund** | A pot of money with a purpose. Types: **Yours** (own), **Goals** (saving towards something), **Investments** (balance only, no market data), **Held for others** (money managed for a named person). |
| **Entry** | One movement of money: *Spent* or *Received*, in one fund. Stored in paise (integers). |
| **Move (transfer)** | Two linked entries moving money between funds. Neutral: never counts as income or spending. |
| **Gain/Loss** | Surplus or deficit: income minus expense across *your* funds for a period. Held-for-others money is excluded. There is no gain/loss on own funds beyond saving or overspending. |
| **Category** | What an entry was for. Default: **General**. |
| **Party** | Optional person or place the money came from or went to. |
| **Person (profile)** | A separate set of funds for one family member on the same device. |
| **Prospective delete** | Deleting a fund, category or party hides it from new entries only; old entries still show it exactly as before. |

---

## 3. Platforms & architecture

- **Stack:** plain HTML/CSS/JavaScript (ES modules), no build step. Runs from any static server.
- **Targets:** Android via Capacitor; desktop via Tauri (or Electron); same code. Also usable as a web app.
- **Storage:** IndexedDB is the source of truth (database `hisaab`, version 3). Stores: `profiles, funds, categories, parties, transactions, recurring, audit` (synced kinds) and `logs` (device-local).
- **Money:** integer paise; display via `Intl.NumberFormat` (`INR`, `en-IN` by default).
- **Cloud (optional):** Firebase Auth (Google), Firestore, Cloud Storage. Loaded lazily from the Firebase CDN only when `js/firebase-config.js` is filled in. Until then the app is fully local.
- **Sync model:** outbox + last-write-wins by `updatedAt`. Audit records are immutable and never overwritten.
- **Extensibility:** a feature is one module exporting `render(root, arg)` plus one line in `js/main.js`. Items marked `.d-only` appear only in Detailed mode.

---

## 4. Modes: Minimal and Detailed

The user switches in Settings → Mode. Minimal is the default.

| Area | Minimal | Detailed |
|---|---|---|
| New entry | Spent/Received/Move, amount, fund, comment | + category, party, date |
| Home | Your money, saved/overspent, fund balances, alerts | + in/out split, budget meters, spending forecast, "where it went" bars |
| Fund page | Balance, entries, copy statement, export | + received/spent split, meter |
| History | Month list | + fund filter |
| Theme controls | Light/dark/auto, accent colour | + roundness, depth, blur, spacing |

**Rule:** switching modes never changes data. Entries logged in Minimal get today's date and the **General** category, so they look normal in Detailed.

---

## 5. Functional requirements

Status key: **✅ Built, logic tested** · **🟡 Built, UI not yet run in a browser** · **🔌 Built, needs Firebase project** · **⛔ Not built**

### 5.1 Funds
- F1 Create, edit, delete (archive) and restore funds. Fields: name, type, held-for name (held type), opening balance, optional monthly budget, colour dot. 🟡
- F2 Fund page: balance, received/spent, budget or "spent of received" meter, entry list, **Copy statement**, **Export…**. 🟡
- F3 Deleted funds stay in History and monthly summaries, appear under "Deleted funds", and can be restored. ✅
- F4 Held-for-others funds are shown separately on Home and excluded from your gain/loss. ✅

### 5.2 Entries
- E1 Add/edit/delete entries: type, amount, fund, category, party, date, **comment**. 🟡
- E2 Inline "+ New category…" and "+ New party…" from the entry form. 🟡
- E3 Editing an old entry keeps its deleted fund/category/party selectable. 🟡
- E4 **Move** between two funds creates two linked entries (`transferId`), excluded from gain/loss. ✅
- E5 Entry delete is soft and recorded in the audit trail. ✅

### 5.3 Categories & Parties
- C1 Add, rename, delete, restore. Rename updates old entries; delete does not. ✅
- C2 *General* is the default category: renameable, not deletable. ✅
- C3 Management screens: Settings → Manage. 🟡

### 5.4 Recurring entries
- R1 Daily, weekly or monthly entries with fund, category, party, comment, next date, active/paused. 🟡
- R2 Due entries are created on app open, including catch-up for missed days, without duplicates. ✅
- R3 Monthly recurrence keeps the original day and clamps to month length (31st → 28th/30th → 31st). ✅
- R4 Deleting a recurring rule never touches entries already created. ✅

### 5.5 Home / dashboard
- D1 "Your money" total, this month's in/out, **Saved / Overspent** verdict. 🟡
- D2 "Held for others" total, labelled as not your money. 🟡
- D3 Fund tiles with balance and meters. 🟡
- D4 **Heads-up** panel (alerts, §5.8). ✅ logic · 🟡 UI
- D5 Spending forecast (month-end projection vs usual) and "Where it went" category bars (Detailed). ✅ logic · 🟡 UI

### 5.6 History
- H1 Month navigation, grouped by day, tap to edit. 🟡
- H2 Fund filter, including deleted funds (Detailed). 🟡

### 5.7 Statements & export
- S1 **Periods:** daily, monthly, yearly, custom range, all time. ✅
- S2 **Filters:** fund, category, party, received/spent. ✅
- S3 **Field picker:** date, fund, category, party, type, amount, comment, running balance, entry ID, last edited. ✅
- S4 Group by date/category/party/fund; sort asc/desc; totals on/off. ✅
- S5 **Formats:** PDF (print), Excel (`.xls`), Word (`.doc`), CSV, TXT, **image (PNG)**, copy as text. 🟡
- S6 **Designs:** Clean, Ledger, Glass, used for PDF, Word and image. 🟡
- S7 Saved presets (e.g. "Parents statement"). 🟡
- S8 Image export caps at 60 rows with a "+N more" note. 🟡

### 5.8 Insights & alerts
- I1 Budget alerts at 80% and over 100% of a fund's monthly budget. ✅
- I2 Fund below zero, and "may run out in ~N days" at the 30-day spending pace. ✅
- I3 Unusual-spend flag: last 7 days, amount > mean + 2σ and ≥ 1.5× mean of ≥ 5 earlier entries in the same category. ✅
- I4 Optional browser notifications while the app is open (opt-in, once per alert per day). 🟡

### 5.9 Audit trail (universal)
- A1 Every create, edit, delete and restore of any record writes an audit record: who, when, entity, label, and before → after changes. ✅
- A2 Append-only: no edit or delete in the UI; imported/synced audit records never overwrite existing ones. ✅
- A3 Viewer with entity filter and expandable diffs. 🟡
- A4 Seed/migration actions are not audited; they are logged instead. ✅

### 5.10 Logs (universal)
- L1 App events: start, sync results, imports/exports, setting changes, PIN changes, unhandled errors. 🟡
- L2 Device-local, last 2,000 kept, filter by level, export as text, clear (clearing is itself logged). 🟡

### 5.11 People (profiles)
- P1 Add and switch people; each has separate funds. Audit records show who acted. 🟡

### 5.12 Backup & security
- B1 JSON export/import (merge by id, newest wins). ✅
- B2 **Encrypted backup**: passphrase → PBKDF2-SHA256 (310k) → AES-256-GCM; wrong passphrase is rejected. ✅
- B3 **PIN lock** (4–8 digits, PBKDF2-hashed), locks on open and after leaving the app for 0/1/5/15 minutes, 5 wrong tries → 30 s wait. 🟡

### 5.13 Account & cloud sync
- N1 Google sign-in; opt-in "Back up and sync my data"; first enable uploads everything, then outbox sync. 🔌
- N2 Data path `users/{uid}/{kind}/{id}`, owner-only. 🔌

### 5.14 Chat (simple, 1:1)
- M1 Choose a unique ID (3–20 chars: a–z, 0–9, dot, underscore; immutable) and display name. 🔌
- M2 Find people by exact @ID, or by name if they are discoverable (toggle in Settings). 🔌
- M3 First message to a stranger is a **request**; the sender can't send more until accepted. Recipient can Accept or Block. Only the blocker can unblock. 🔌
- M4 Text, images and files. Images auto-compressed to ≤ 1600 px / 5 MB; files ≤ 10 MB; types: JPG, PNG, WebP, PDF, TXT, CSV, DOCX, XLSX. 🔌
- M5 Chat list with last message, request/waiting/blocked tags, unread counts, nav badge, in-app notification. 🔌
- M6 Out of scope: groups, calls, voice notes, reactions, message edit/delete, read receipts.

---

## 6. Design system & theme

**Style:** soft **neumorphism** (raised and inset surfaces from paired light/dark shadows) combined with **glassmorphism** (translucent, blurred panels over a soft gradient backdrop). Minimal density, generous spacing, one accent colour.

### 6.1 Design tokens (`css/tokens.css`)
| Token | Default | User control |
|---|---|---|
| `--accent-h` (hue) | 162 | Accent colour slider (Minimal + Detailed) |
| `--accent-s` | 52% | fixed |
| `--radius` | 22px | Roundness 6–36 (Detailed) |
| `--blur` | 18px | Glass blur 0–36 (Detailed) |
| `--depth` | 10px | Soft-shadow depth 2–18 (Detailed) |
| `--density` | 1 | Spacing 0.75–1.4 (Detailed) |
| `--font` | Manrope → Avenir Next → ui-rounded → system | file swap |
| Theme | Auto | Auto / Light ("mist") / Dark ("ink") |

### 6.2 Themes
- **Mist (light):** background `#e3e8ee`, ink `#222a33`, white highlight + cool-grey shadow, translucent white glass.
- **Ink (dark):** background `#1a1f26`, ink `#e8edf3`, faint highlight + deep shadow, translucent slate glass.
- Both use three blurred backdrop blobs (accent-tinted, blue, warm). Positive = green, negative = red-orange.
- Settings can be reset to defaults in one tap; preferences persist locally.

### 6.3 Components
Hero card (raised), fund tiles (raised, pressed state inset), glass cards, inset inputs and meters, segmented controls, pill chips, bottom sheet for forms, toast, floating glass nav (bottom bar on mobile, sidebar ≥ 900 px) with a central Add button and a chat unread badge.

### 6.4 Accessibility & motion
Visible focus rings, `aria-label`s on icon buttons, `role="status"`/`alert` for toast and lock errors, 44 px+ touch targets on primary actions, `prefers-reduced-motion` disables transitions. Colour is never the only signal (labels/signs accompany red/green).

---

## 7. Local data model

All records have `id`, `updatedAt`; most have `createdAt` and `deleted` (soft delete).

- **profiles:** `{ name }`
- **funds:** `{ profileId, name, type, holder, opening, budget, hue }` (amounts in paise)
- **categories / parties:** `{ name }` (category *General* has fixed id `cat-general`)
- **transactions:** `{ fundId, type: in|out, amount, categoryId, partyId, note (shown as "Comment"), date: YYYY-MM-DD, transferId?, recurringId? }`
- **recurring:** `{ fundId, type, amount, categoryId, partyId, note, every: daily|weekly|monthly, next, day, active }`
- **audit:** `{ ts, actor{id,name}, entity, entityId, action: create|update|delete|restore, label, changes{field:[old,new]} }`
- **logs (local):** `{ ts, level, msg, ctx }`

Cloud and chat collections, with the security rules they require, are in `docs/CHAT_SPEC.md`.

---

## 8. Security & privacy

- Money data is local by default. Cloud sync is explicit opt-in, per account, owner-only by rules.
- Chat uses TLS and Firestore/Storage rules; it is **not** end-to-end encrypted. Financial statements shared in chat are visible to Firebase infrastructure.
- Message requests, block and the one-message-until-accepted rule protect against spam from strangers who find your ID.
- PIN lock deters casual access to an unattended device; it does not encrypt local data.
- Encrypted backups protect exported files with a passphrase the user alone holds (lost passphrase = unrecoverable).
- No analytics, no ads, no third-party trackers.

---

## 9. Non-functional requirements

- **Offline:** every feature except sign-in, sync and chat works with no connection.
- **Performance:** instant open for family-scale data (thousands of entries); statements and image export are generated on-device.
- **Integrity:** integer money, soft deletes, immutable audit, merge-by-newest import.
- **Portability:** one codebase for web, Android and desktop; no server of our own.
- **Localisation:** currency and locale configurable; UI copy is English.
- **Cost:** Firebase Blaze plan is required for Cloud Storage (chat attachments); expected cost at family scale is near zero. Set a budget alert.

---

## 10. Status & known limitations

- **Tested:** core logic via automated checks: balances, gain/loss, prospective deletes, audit and its immutability, transfers, recurring catch-up and month-end, alerts, forecast, unusual spends, encryption, statement building, CSV/TXT/HTML output.
- **Not yet run:** the screens in a real browser; all Firebase features against a real project.
- Excel and Word exports are HTML-based `.xls`/`.doc` (Excel may warn about format). PDF uses the print dialog, which may be unreliable inside the Android wrapper.
- `signInWithPopup` does not work inside an Android WebView; needs a native auth plugin.
- Push notifications when the app is closed are not implemented (needs FCM and Cloud Functions).
- Firebase SDK loads from a CDN; bundle it locally for first-launch offline use in wrapped apps.
- Biometric unlock needs a native plugin; PIN is the web fallback.
- Chat has no message edit/delete and denormalised names can go stale after a rename.

---

## 11. Roadmap (deferred, not committed)

1. Cloud rules, App Check and FCM push (via Antigravity/Firebase).
2. Capacitor Android build, native Google sign-in, biometrics, SMS/UPI auto-import.
3. Real `.xlsx`, `.docx` and PDF generation (bundled libraries).
4. AI features: receipt scan with auto-filled entry; natural-language and voice quick add. Needs a small backend so no API key ships in the app, plus explicit consent.
5. Shared funds with approval workflow (e.g. a parent approves spends over a limit) and split/settle-up.
6. Optional end-to-end encrypted chat.
7. Multi-currency, goal projections, what-if simulator, charts over time.

---

## 12. Risks & open questions

| Risk / question | Note |
|---|---|
| Security rules are the real chat security | Must be implemented exactly as in the spec and tested with the Firebase emulator before real use. |
| Strangers can message anyone with an ID | Mitigated by requests, block and rules; consider an ID-privacy setting later. |
| Local data is unencrypted | Acceptable for the stated non-commercial scope; encrypted backups cover export. |
| Name for the product | "Hisaab" is a placeholder. |
| Statement formats | Real `.xlsx`/`.docx` pending a bundler. |

---

## 13. Project structure

```
index.html
css/        tokens.css · base.css · components.css
js/         config.js · main.js · ui.js · firebase-config.js
js/core/    models · calc · db · store · sync · cloud · insights · recurring · export · crypto · lock · prefs · log
js/modules/ dashboard · funds · history · txn-sheet · manage · recurring · statements · audit · logs · chat · settings
docs/       PRD.md · CHAT_SPEC.md
README.md · package.json
```
