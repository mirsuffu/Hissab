# Exhaustive FinTech QA & Resilience Audit Test Suite
**Application Scope:** Personal Money Management (PMM) & Isolated Fund Management System (FMS)  
**Author:** Principal FinTech QA & Resilience Engineering  
**Standard Compliance:** GAAP / IFRS / ISO 20022 / OWASP ASVS 4.0 Level 3 / WCAG 2.1 AA/AAA  

---

## 1. Concurrency, Race Conditions & Distributed Transactions

### TC-CONC-01: Parallel Multi-Threaded TOCTOU Double-Spend on Liquid Balances
- **Category:** Concurrency, Race Conditions & Distributed Transactions
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - PMM Account `ACC-8821` liquid available balance: Exactly **$1,000.00 USD**.
  - Target FMS Fund `FUND-ALPHA` minimum tranche entry: **$1,000.00 USD**.
  - Client has an authenticated session with valid non-idempotent or forged bearer tokens.
- **Execution Steps:**
  1. Open 2 simultaneous HTTP/2 streams over a single multiplexed TCP connection using a testing harness (e.g., Locust / custom Go routine).
  2. Stream 1 fires: `POST /api/v1/pmm/transfers/external` (Withdraw $1,000.00 to external ACH).
  3. Stream 2 fires: `POST /api/v1/fms/invest` (Inject $1,000.00 into `FUND-ALPHA`).
  4. Both packets are timed with server-side TCP arrival delta $< 0.5\text{ ms}$.
- **Expected Behavior:**
  - Database row-level locking (`SELECT ... FOR UPDATE`) or serializable isolation (`ISOLATION LEVEL SERIALIZABLE`) must lock the balance row of `ACC-8821`.
  - Exactly one request succeeds with HTTP `200 OK`. The second request fails deterministically with HTTP `409 Conflict` or HTTP `422 Unprocessable Entity` ("Insufficient funds"). Account balance remains exactly **$0.00 USD**.
- **Defect Hypothesis:**
  - Application layer performs a non-atomic "Read balance -> Validate $\ge$ 1,000 -> Write debit" pattern. If isolation level is `READ COMMITTED` without pessimistic locks, both read operations see $1,000.00 before either writes, resulting in a **-$1,000.00 overdraft** or unbacked units issued in `FUND-ALPHA`.
- **Severity:** `Critical`

---

### TC-CONC-02: Auto-Sweep Millisecond Collision with POS Card Authorization
- **Category:** Concurrency, Race Conditions & Distributed Transactions
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User has active recurring rule: *"Auto-sweep any balance exceeding $500.00 into FMS Index Fund at 00:00:00 UTC daily"*.
  - PMM checking account has **$750.00 USD**.
  - Sweep amount calculated: **$250.00 USD**.
- **Execution Steps:**
  1. At `23:59:59.980 UTC`, internal cron triggers background worker `Job-Sweep-391` to debit $250.00 from PMM.
  2. At `23:59:59.985 UTC`, Visa network fires a real-time ISO 8583 authorization webhook: `POST /webhooks/card-auth` for **$700.00 USD** grocery purchase.
- **Expected Behavior:**
  - Ledger engine must atomically resolve pending reservations.
  - If card authorization arrives first, balance drops to $50.00; auto-sweep evaluates threshold, detects remaining balance $< $500, and gracefully skips or aborts the sweep.
  - If auto-sweep locks first, available balance drops to $500.00; card authorization of $700.00 is rejected with ISO 8583 response code `51` ("Insufficient Funds"). Under no circumstance does the account go to -$200.00.
- **Defect Hypothesis:**
  - PMM splits balance into `cached_balance` in Redis and `ledger_entries` in SQL. Auto-sweep writes directly to the DB while Card Gateway reads from an un-invalidated Redis cache, resulting in double-commitment.
- **Severity:** `Critical`

---

### TC-CONC-03: Saga/2PC Distributed Transaction Partial Network Partition & Rollback Failure
- **Category:** Concurrency, Race Conditions & Distributed Transactions
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - PMM database is on Postgres Cluster A; FMS database is on Postgres Cluster B (separate microservices).
  - PMM balance: **$5,000.00 USD**.
- **Execution Steps:**
  1. User triggers an injection of $5,000.00 from PMM to FMS.
  2. Orchestrator executes Step 1: PMM debits $5,000.00 and marks state `PENDING_FMS_ISSUANCE`.
  3. Orchestrator calls FMS `POST /fms/units/issue`.
  4. Inject an artificial TCP timeout (simulate socket drop / HTTP 504 Gateway Timeout) right after FMS receives the payload but before FMS sends the response.
  5. Orchestrator initiates compensating transaction: `POST /pmm/compensate-credit`.
  6. Simultaneously, simulate FMS internal async commit succeeding and issuing 50 units.
- **Expected Behavior:**
  - Idempotent saga coordination: The compensating transaction must not blindly refund PMM without querying FMS unit issuance status via reconciliation token / two-phase commit consensus.
  - State must be placed in `SETTLEMENT_SUSPENDED` pending automated ledger reconciliation; funds are neither duplicated nor lost.
- **Defect Hypothesis:**
  - PMM compensation handler assumes HTTP 504 means failure and refunds $5,000.00 back to PMM. Meanwhile, FMS finished issuance. The user now possesses both $5,000.00 liquid cash and $5,000.00 worth of fund units ($5,000 created out of thin air).
- **Severity:** `Critical`

---

## 2. Logical, Business Rules & Regulatory Limits

### TC-BIZ-01: Fractional Currency Round-Tripping Arbitrage (2-Decimal vs. 6-Decimal Mismatch)
- **Category:** Logical, Business Rules & Regulatory Limits
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - PMM balances are tracked in fiat cents (2 decimal places: `0.01 USD`).
  - FMS Unit Ledger tracks shares at 6 decimal places (`0.000001 Units`).
  - `FUND-BETA` NAV = **$3.00 USD / unit**.
- **Execution Steps:**
  1. Script initiates repeated injections of **$0.01 USD** into `FUND-BETA`.
  2. Calculation: $\$0.01 / \$3.00 = 0.00333333...$ units.
  3. System rounds units up to 6 decimals: `0.003334 Units`.
  4. Script immediately redeems `0.003334 Units` back to PMM at NAV $3.00:
     $$0.003334 \times \$3.00 = \$0.010002$$
  5. PMM rounds cash credit to nearest cent: **$0.010002 -> $0.01 USD** (or if ceiling rounding is implemented, **$0.02 USD**).
  6. Loop this sequence 100,000 times via automated API script.
- **Expected Behavior:**
  - Unit creation must enforce strict truncating/conservative floor rounding against the client (round down unit issuance, round down redemption payouts), or enforce a minimum transaction threshold (e.g., $10.00 minimum transfer) to eliminate sub-cent micro-arbitrage.
- **Defect Hypothesis:**
  - Inconsistent rounding modes (`HALF_UP` on unit issuance vs `CEIL` on redemption) bleed liquidity from the fund pool to the personal account, violating conservation of ledger assets.
- **Severity:** `High`

---

### TC-BIZ-02: Chargeback / ACH Return on Funds Already Locked in Illiquid Private Equity Tranche
- **Category:** Logical, Business Rules & Regulatory Limits
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User deposits $25,000.00 via ACH into PMM.
  - User immediately subscribes $25,000.00 to `FMS-VENTURE-X` (a closed-end 3-year illiquid lock-in tranche).
  - PMM available cash is now $0.00; FMS holds $25,000.00 allocated into illiquid assets.
- **Execution Steps:**
  1. On Day 4 (within NACHA 60-day return window), the originating bank issues an ACH Return Code `R01` (Insufficient Funds) or `R10` (Customer Advises Unauthorized).
  2. PMM receives the inbound return notification.
- **Expected Behavior:**
  - System checks PMM cash: detects $0.00.
  - System flags user account as `AML_DELINQUENT_HOLD`.
  - PMM balance transitions to negative balance (-$25,000.00) with legal debt obligation flag.
  - FMS units must NOT be magically liquidated if the fund rules forbid premature liquidity; instead, FMS units must be frozen as collateral/lien against the negative PMM balance.
- **Defect Hypothesis:**
  - Automated webhook handler attempts an automatic compensating debit directly against FMS, causing an unhandled runtime exception because FMS rejects redemptions during lock-in, leaving PMM un-reconciled and the bank return unrecorded.
- **Severity:** `Critical`

---

### TC-BIZ-03: Bypass of Tier 1 KYC Annual Limit via Multi-Account / Multi-Currency Smurfing
- **Category:** Logical, Business Rules & Regulatory Limits
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User KYC Status: Tier 1 (Retail, unverified proof of wealth).
  - Regulatory Limit: Maximum annual investment in pooled funds = **$10,000.00 USD** equivalent.
  - User opens 3 separate PMM checking sub-wallets (USD, EUR, GBP).
- **Execution Steps:**
  1. Transfer $9,000.00 USD into FMS Fund. (Total = $9,000.00; valid).
  2. From EUR sub-wallet, transfer €1,500.00 EUR (approx. $1,650.00 USD) into the same FMS Fund.
  3. From GBP sub-wallet, transfer £1,000.00 GBP (approx. $1,300.00 USD) into the same FMS Fund.
- **Expected Behavior:**
  - FMS centralized compliance gateway must aggregate investor exposure across all linked sub-wallets and currencies normalized to USD base at the exact spot exchange rate.
  - Step 2 or 3 must be blocked with HTTP `403 Forbidden` / `COMPLIANCE_LIMIT_EXCEEDED`.
- **Defect Hypothesis:**
  - Limits are enforced only per-currency-ledger (`usd_invested < 10000`, `eur_invested < 10000`) rather than globally across the master beneficial owner entity, allowing regulatory evasion.
- **Severity:** `High`

---

## 3. Arithmetic, Precision & Floating-Point Edge Cases

### TC-ARITH-01: IEEE-754 Floating-Point Drift in Sub-Cent Management Fee Deductions
- **Category:** Arithmetic, Precision & Floating-Point Edge Cases
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - FMS Fund holds **$10,000,000.00 USD** across 30,000 micro-investors.
  - Daily accrued management fee rate: $0.00004109589$ ($1.5\%$ per annum / 365).
- **Execution Steps:**
  1. Trigger end-of-day fee calculation worker across all 30,000 investor balances.
  2. Observe calculations executed in JavaScript/Python runtime using standard `Number` (IEEE-754 double precision float).
- **Expected Behavior:**
  - Calculations must strictly use arbitrary-precision decimal libraries (`BigDecimal`, `Decimal128`, or integer micro-cents: $1\text{ cent} = 10,000\text{ micro-cents}$).
  - Sum of all individual fee deductions must balance against the master vault fee receipt to the exact smallest currency subdivision ($0.01).
- **Defect Hypothesis:**
  - Using native float arithmetic results in cumulative drift:
    $$0.1 + 0.2 = 0.30000000000000004$$
    Over 30,000 accounts, several dollars disappear or appear out of nowhere, causing the general ledger audit check to fail reconciliation at end-of-month.
- **Severity:** `High`

---

### TC-ARITH-02: Boundary Attack with Negative Zero, NaN, and Integer Overflow (Safe Integer Ceiling)
- **Category:** Arithmetic, Precision & Floating-Point Edge Cases
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Client has active session on transfer/invest modal.
- **Execution Steps:**
  1. Submit injection payload: `{"amount": -0.00}`.
  2. Submit injection payload: `{"amount": "-0.01"}`.
  3. Submit injection payload: `{"amount": "NaN"}`.
  4. Submit injection payload: `{"amount": 9007199254740992}` (exceeding JavaScript `Number.MAX_SAFE_INTEGER` $2^{53} - 1$).
  5. Submit injection payload: `{"amount": 9223372036854775808}` (exceeding 64-bit signed SQL `BIGINT`).
- **Expected Behavior:**
  - Strict input sanitization and schema validation (e.g., Zod / Joi / JSON Schema).
  - All non-positive or malformed payloads rejected with HTTP `400 Bad Request`.
  - Values exceeding supported bounds rejected before reaching the SQL persistence layer.
- **Defect Hypothesis:**
  - Payload `"amount": "NaN"` parses in JavaScript as `NaN`. If validation checks `if (amount < 0.01)` it evaluates to `false` (`NaN < 0.01` is `false`). The execution proceeds to balance debit, corrupting the database row with `NULL` or string `"NaN"`, permanently crashing subsequent user balance queries.
- **Severity:** `Critical`

---

### TC-ARITH-03: Division by Zero in Initial NAV Calculation for Newly Seeded Fund
- **Category:** Arithmetic, Precision & Floating-Point Edge Cases
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - New fund `FUND-NEW` created with $0.00 initial capital and 0 total units.
- **Execution Steps:**
  1. Trigger NAV refresh service: $\text{NAV} = \frac{\text{Net Assets}}{\text{Total Units Issued}}$.
  2. User attempts an exploratory preview call: `GET /api/v1/fms/funds/FUND-NEW/quote?investment=500`.
- **Expected Behavior:**
  - System recognizes zero-unit state and returns the nominal par seed price (e.g., $1.000000 USD/unit) defined in fund prospectus.
- **Defect Hypothesis:**
  - Server evaluates $\frac{0}{0}$ without guard clauses, resulting in `ZeroDivisionError` (Python) or `Infinity` (JS). The API throws HTTP `500 Internal Server Error`, or worse, returns `price_per_unit: null`, crashing the mobile client UI parsing logic.
- **Severity:** `Medium`

---

## 4. Network Instability, Latency & Asynchronous Failures

### TC-NET-01: Idempotency Key Reuse Under Gateway Timeout Retry Storm
- **Category:** Network Instability, Latency & Asynchronous Failures
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Mobile client initiates $2,500.00 investment into FMS.
  - Client generates UUID v4 idempotency key: `Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`.
- **Execution Steps:**
  1. Client sends `POST /api/v1/fms/invest` with the idempotency header.
  2. Server begins processing: debits PMM, commits transaction to payment rail.
  3. Simulate network drop: Client TCP stack drops connection after 10 seconds of silence (server is slow responding).
  4. Client mobile app auto-retries the exact same request 3 times at 5-second intervals with the identical `Idempotency-Key`.
- **Expected Behavior:**
  - Server uses an atomic distributed lock on the idempotency key in Redis (e.g., `SET key val NX EX 120`).
  - First retry while request 1 is still processing returns HTTP `409 Conflict` ("Request in progress") or waits on the original lock.
  - Retries after completion return the exact cached response of the first transaction (HTTP `200 OK`, same `transaction_id`). Exactly one debit occurs.
- **Defect Hypothesis:**
  - Idempotency key is saved in DB *only after* the entire transaction commits. The incoming retries arrive while request 1 is mid-flight; finding no existing idempotency record, they execute parallel debits, multiplying the transfer by 4x.
- **Severity:** `Critical`

---

### TC-NET-02: Stale Delayed Webhook Settling Against Shifted NAV Window
- **Category:** Network Instability, Latency & Asynchronous Failures
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User authorizes fund purchase at 15:00 UTC when NAV is **$100.00 USD**.
  - Daily NAV recalculation occurs at 20:00 UTC; new NAV is **$115.00 USD**.
- **Execution Steps:**
  1. Third-party payment gateway experiences infrastructure backlog; webhook `charge.succeeded` is delayed by 6 hours, arriving at 21:00 UTC.
  2. Inbound webhook handler parses transaction and calls `issue_units(user_id, amount=1000)`.
- **Expected Behavior:**
  - Settlement engine checks the transaction creation timestamp vs the NAV cutoff timetable.
  - System applies the correct historical effective NAV ($100.00) if forward-pricing rules apply, or recalculates based on regulatory prospectus terms (Next Day Valuation Policy), accompanied by an explicit audit journal entry explaining the delayed execution basis.
- **Defect Hypothesis:**
  - Worker blindly fetches `current_nav = Fund.objects.get(id).nav` at time of execution (21:00 UTC), purchasing units at $115.00 instead of $100.00, resulting in immediate loss of unit value to the investor.
- **Severity:** `High`

---

### TC-NET-03: Half-Open TCP Handshake During Network Handover (Wi-Fi to 5G)
- **Category:** Network Instability, Latency & Asynchronous Failures
- **Platform Scope:** `Mobile-Specific`
- **Preconditions & Setup State:**
  - User is on mobile app initiates an instant auto-sweep transfer.
- **Execution Steps:**
  1. Tap "Confirm Transfer".
  2. While device is sending TLS packets, force an instantaneous network interface switch: disconnect Wi-Fi, forcing OS fallback to cellular data.
  3. The initial TCP socket enters a half-open state (client closed, server socket waiting).
- **Expected Behavior:**
  - Mobile client cleanly handles connection abort, catches socket error, enters polling state using transaction inquiry `GET /api/v1/transfers/{client_generated_uuid}`, and renders a clear "Verifying Transfer Status" spinner rather than throwing a raw uncaught network error.
- **Defect Hypothesis:**
  - Unhandled promise rejection freezes the mobile view with the button in a permanent disabled/loading state. User force-quits the app, assumes transfer failed, and attempts it again upon relaunch, causing duplicate user action.
- **Severity:** `Medium`

---

## 5. Cross-Currency, Multi-Tenant & Time Zone Anomalies

### TC-TIME-01: Midnight NAV Cut-Off Window Race Condition (23:59:59 UTC)
- **Category:** Cross-Currency, Multi-Tenant & Time Zone Anomalies
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Fund rules state: Orders placed before 23:59:59 UTC receive Day $T$ NAV; orders placed $\ge$ 00:00:00 UTC receive Day $T+1$ NAV.
- **Execution Steps:**
  1. Client sends order at `23:59:59.850 UTC`.
  2. API gateway edge proxy (e.g., Cloudflare/AWS ALB) receives it at `23:59:59.950 UTC`.
  3. Internal message queue (RabbitMQ / Kafka) buffers request; consumer worker picks it up at `00:00:01.100 UTC`.
- **Expected Behavior:**
  - Valuation pricing must be bound to the cryptographically verified client-inbound timestamp stamped by the API edge gateway (`X-Request-Timestamp`), not the arbitrary async queue processing time.
- **Defect Hypothesis:**
  - Backend uses `datetime.utcnow()` inside the queue consumer worker. A 2-second processing lag pushes the order into Day $T+1$, unfairly altering the investor's entry pricing.
- **Severity:** `High`

---

### TC-TIME-02: Recurring Monthly Transfer Scheduling on Day 31 vs. Leap Years
- **Category:** Cross-Currency, Multi-Tenant & Time Zone Anomalies
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User configures recurring monthly transfer: *"Transfer $500 from PMM to FMS on the 31st of every month"*.
- **Execution Steps:**
  1. System runs through calendar progression: January 31 -> February (non-leap year, 28 days) -> March 31 -> April 30.
- **Expected Behavior:**
  - Scheduler evaluates rule via financial standard convention (Modified Following / End of Month Rule): executes on February 28, April 30, etc., without skipping months or silently dropping recurring rules.
- **Defect Hypothesis:**
  - Native cron or simplistic date math `target_date.setMonth(target_date.getMonth() + 1)` rolls February 31 into March 3, causing two transfers in March and zero transfers in February, distorting investor scheduled cash flows.
- **Severity:** `Medium`

---

### TC-TIME-03: Daylight Saving Time (DST) Fall-Back Dual Execution
- **Category:** Cross-Currency, Multi-Tenant & Time Zone Anomalies
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User in `America/New_York` sets a daily automated cash sweep at 01:30 AM local time.
  - November DST transition: At 02:00 AM, clocks roll back to 01:00 AM.
- **Execution Steps:**
  1. Cron worker runs at 01:30 AM (EDT).
  2. Clock rolls back 1 hour; 01:30 AM (EST) occurs 60 minutes later.
- **Expected Behavior:**
  - Scheduled jobs must run on UTC timestamps or maintain a stateful `last_executed_day: YYYY-MM-DD` ledger, preventing the job from firing twice on the same calendar day.
- **Defect Hypothesis:**
  - Scheduler matches solely on local server wall-clock time string `01:30`. The sweep runs twice, draining the user's PMM balance twice in one night.
- **Severity:** `High`

---

## 6. State Machine & Lifecycle Transitions

### TC-STATE-01: Zombie Redemption from Liquidating / Regulatory Frozen Fund
- **Category:** State Machine & Lifecycle Transitions
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - `FUND-GAMMA` enters regulatory shutdown; Admin sets status to `FROZEN_FOR_LIQUIDATION`.
  - Client has existing open dashboard view showing "Redeem" button enabled.
- **Execution Steps:**
  1. User clicks "Redeem 100% of Units".
  2. Client payload fires: `POST /api/v1/fms/funds/FUND-GAMMA/redeem`.
- **Expected Behavior:**
  - Server state-machine checks fund status inside transaction lock: detects `FROZEN_FOR_LIQUIDATION`.
  - Rejects request with HTTP `423 Locked` or `400 Bad Request` ("Fund is currently undergoing liquidation. Capital will be distributed pro-rata by liquidator").
- **Defect Hypothesis:**
  - State check only verifies `user_units > 0` and omits the master fund status check. Redemption succeeds, disbursing cash from general vault reserves while the underlying assets remain distressed and illiquid.
- **Severity:** `Critical`

---

### TC-STATE-02: Simultaneous Admin Portfolio Rebalancing During Investor Injection
- **Category:** State Machine & Lifecycle Transitions
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - FMS Fund `FUND-BALANCED` holds 60% Equities / 40% Bonds.
  - Admin initiates automated rebalance script to 50% Equities / 50% Bonds.
- **Execution Steps:**
  1. Rebalance script acquires lock on portfolio composition table.
  2. Exactly while asset sell/buy orders are executing on the broker gateway, user submits a $50,000.00 new capital injection.
- **Expected Behavior:**
  - Either the injection is queued until the rebalance transaction completes and commits new portfolio asset weights, or the injection enters an unallocated cash tranche until the next valuation cut-off.
- **Defect Hypothesis:**
  - Capital injection modifies total fund asset value mid-rebalance calculation. The rebalance script uses dirty total equity figures, miscalculates order tranche sizing, and buys excessive equity shares, causing an unintended fund leverage exposure.
- **Severity:** `Critical`

---

## 7. Security, Access Controls & IDOR

### TC-SEC-01: IDOR in Portfolio Allocation / Sweep Destination Route
- **Category:** Security, Access Controls & IDOR
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Attacker User A (Account `USR-001`, Portfolio `PRF-111`).
  - Victim User B (Account `USR-002`, Portfolio `PRF-222`).
- **Execution Steps:**
  1. Attacker sends payload to modify sweep settings:
     ```json
     POST /api/v1/pmm/sweep-rules
     {
       "source_account_id": "ACC-001-A",
       "target_portfolio_id": "PRF-222",
       "sweep_threshold": 100.00
     }
     ```
  2. Attacker attempts to query: `GET /api/v1/fms/investors/USR-002/statement`.
- **Expected Behavior:**
  - Authorization middleware enforces strict ownership boundary: `target_portfolio.user_id === authenticated_user.id`.
  - Request rejected with HTTP `403 Forbidden`. No cross-account data leakage.
- **Defect Hypothesis:**
  - Backend verifies that `source_account_id` belongs to User A, but fails to validate ownership of `target_portfolio_id`, allowing User A to divert their sweep into User B's portfolio or siphon funds into arbitrary un-owned vehicles.
- **Severity:** `Critical`

---

### TC-SEC-02: Parameter Tampering / Privilege Escalation on Fee Overrides
- **Category:** Security, Access Controls & IDOR
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Standard retail user has 2.0% annual management fee tier.
- **Execution Steps:**
  1. User intercepts fund investment submission via Burp Suite / proxy.
  2. Modifies JSON payload:
     ```json
     POST /api/v1/fms/invest
     {
       "fund_id": "FUND-01",
       "amount": 10000.00,
       "management_fee_bps": 0,
       "status": "SETTLED",
       "bypass_kyc": true
     }
     ```
- **Expected Behavior:**
  - Server-side DTO (Data Transfer Object) enforces strict schema allowlisting. Untrusted client properties must be ignored or cause strict validation failure (HTTP `400 Bad Request`).
  - Fee schedules and transaction states must be assigned exclusively by backend domain services.
- **Defect Hypothesis:**
  - Mass-assignment vulnerability (e.g., ORM `FundSubscription.create(req.body)`). Overridden values bind directly to database columns, permitting zero-fee investments or instant self-settlement.
- **Severity:** `Critical`

---

## 8. UI/UX Client-State Synchronization & Interaction Logic

### TC-UI-01: Rapid Double-Tap / Multi-Click Debounce Bypass on Desktop and Mobile
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User on slow 3G connection with $500.00 balance.
  - "Invest $500" modal is open.
- **Execution Steps:**
  1. User rapidly taps "Confirm" 5 times in $< 300\text{ ms}$.
  2. Alternatively, on desktop, user triggers Enter keypress while simultaneously clicking the mouse button.
- **Expected Behavior:**
  - Button enters disabled state immediately on first click/pointer-down.
  - Client state machine transitions to `SUBMITTING`, ignoring all subsequent events until resolved.
- **Defect Hypothesis:**
  - Debounce logic is applied on `onClick` rather than immediate `pointerDown`. Rapid events queue 3 network requests before React re-renders the disabled state, sending duplicate HTTP requests.
- **Severity:** `High`

---

### TC-UI-02: Optimistic UI Desync Allowing Phantom Secondary Actions
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - PMM shows balance: **$200.00 USD**.
- **Execution Steps:**
  1. User initiates $200.00 transfer to external wallet.
  2. Client optimistically updates UI balance display to **$0.00 USD**.
  3. Simulate API call failing on the wire with HTTP `500 Internal Server Error`.
  4. App catches failure but fails to revert optimistic Redux/Zustand state store.
- **Expected Behavior:**
  - Client triggers immediate state rollback to $200.00, accompanied by a prominent, non-obtrusive toast notification ("Transfer failed. Your balance has been restored.").
- **Defect Hypothesis:**
  - Developer implemented optimistic deduction but omitted error rollback in the `.catch()` block. The UI displays $0.00, causing user panic and preventing legitimate subsequent transactions until app cache is purged.
- **Severity:** `Medium`

---

### TC-UI-03: Multi-Tab / Multi-Window BroadcastChannel Desynchronization
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Desktop-Specific`
- **Preconditions & Setup State:**
  - User opens Web/Electron app on dual monitors.
  - Window 1: PMM Settings -> Currency conversion / balance reallocation.
  - Window 2: FMS Fund Order Confirmation Dialog open for $5,000.00.
- **Execution Steps:**
  1. In Window 1, user withdraws $5,000.00 to external bank account. Window 1 balance updates to $0.00.
  2. Without refreshing Window 2, user immediately clicks "Confirm $5,000 Investment" in Window 2.
- **Expected Behavior:**
  - Window 1 broadcasts balance update event via `BroadcastChannel` or `WebWorker`.
  - Window 2 intercepts event, marks current open modal invalid, and presents a dynamic banner: *"Your balance has changed in another window. Modal refreshed."*
- **Defect Hypothesis:**
  - Window 2 relies entirely on static component props passed when the modal was opened. It proceeds with the stale submission, generating unhandled server rejections or desynced error displays.
- **Severity:** `Medium`

---

## 9. UI Design, Layout, Component Placement & Visual Integrity

### TC-LAYOUT-01: Virtual Software Keyboard Pushing Confirmation CTA Off-Screen
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Mobile-Specific`
- **Preconditions & Setup State:**
  - Tested on iPhone 13 mini / SE (small viewport) and Samsung Galaxy S22 with numeric soft keyboard enabled.
  - Multi-step investment sheet open with amount input field focused.
- **Execution Steps:**
  1. Tap input field to enter amount. Soft keyboard deploys, consuming ~45% of vertical viewport height.
  2. Enter value `$5,000`.
- **Expected Behavior:**
  - Viewport utilizes dynamic viewport units (`100dvh`) with `KeyboardAvoidingView` / flex scroll container.
  - The primary "Review & Confirm" CTA remains pinned above the keyboard or easily reachable via minimal scroll, never occluded or clipped beneath the keyboard frame.
- **Defect Hypothesis:**
  - Fixed-position modal container (`height: 100vh`) gets compressed; the CTA button is pushed into an invisible overflow zone beneath the virtual keyboard. User cannot submit without dismissing the keyboard first, which is unintuitive.
- **Severity:** `Medium`

---

### TC-LAYOUT-02: Desktop Scaling (125% - 150%) Modal Header & Button Clipping
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Desktop-Specific`
- **Preconditions & Setup State:**
  - Windows OS Display Settings set to **150% Scale** (standard default on many 13-inch 1080p laptops).
  - Screen resolution: $1920 \times 1080$ scaled effectively to $1280 \times 720$.
- **Execution Steps:**
  1. Open FMS Prospectus & Subscription modal (contains legal disclosure text, checkboxes, and confirmation buttons).
- **Expected Behavior:**
  - Modal content must have max-height constraint (`max-h-[85vh]`) with internal scrollbar (`overflow-y: auto`).
  - Header and footer action bar remain fully visible and sticky.
- **Defect Hypothesis:**
  - Modal container set to rigid `height: 750px`. At 150% DPI scaling, the modal overflows the bottom edge of the physical screen, cutting off the legal checkbox and "Submit" button completely.
- **Severity:** `High`

---

### TC-LAYOUT-03: Proximity Hazard: "Cancel Order" Adjacent to "Confirm" Without Safeguard
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - High-value FMS capital injection screen ($100,000+).
- **Execution Steps:**
  1. Inspect button placement on the bottom action bar.
- **Expected Behavior:**
  - Clear visual separation: Primary CTA ("Confirm Investment") is high-contrast, dominant.
  - Destructive/dismissive action ("Cancel") has adequate spatial margin ($\ge 16\text{px}$ gap), uses subtle ghost/text styling, or requires secondary modal confirmation.
- **Defect Hypothesis:**
  - "Withdraw All" or "Cancel" is styled as an equally weighted full-width block directly abutting "Confirm", leading to frequent accidental touch cancellations or fat-finger misfires on touchscreens.
- **Severity:** `Low`

---

### TC-LAYOUT-04: Large Number Overflow & Tabular Truncation in Performance Dashboards
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Desktop-Specific`
- **Preconditions & Setup State:**
  - User holds portfolio value exceeding $100,000,000.00 or high-denomination foreign currencies (e.g., 150,000,000 JPY / IDR).
- **Execution Steps:**
  1. Navigate to dense tabular FMS Master Ledger view on desktop.
  2. Toggle multi-currency column view.
- **Expected Behavior:**
  - Layout utilizes `tabular-nums` monospace alignment, automatic responsive column wrapping, or smart compact abbreviations (`$100.2M`) with full precision tooltips on hover.
  - No text wraps awkwardly across multiple lines breaking row alignment.
- **Defect Hypothesis:**
  - Fixed-width table cells (`width: 100px`) truncate values to `$100,00...` or spill over into adjacent columns, causing misreading of critical financial figures.
- **Severity:** `Medium`

---

### TC-LAYOUT-05: Bidirectional Layout (RTL) Layout Inversion in Arabic/Hebrew
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User switches application language to Arabic (`ar-SA`) or Hebrew (`he-IL`).
- **Execution Steps:**
  1. View fund allocation progress bars, negative balance indicators, and navigation chevrons.
- **Expected Behavior:**
  - Full RTL mirror: progress bars fill from right to left; directional chevrons point appropriately.
  - Financial numbers and currency symbols maintain correct standard formatting: Negative sign `-` must stay bound to the numeric value (e.g., `-500.00 ر.س` not `500.00- ر.س`).
- **Defect Hypothesis:**
  - Naive CSS `direction: rtl` flips numeric strings or puts minus signs at the wrong end of numbers, leading users to mistake negative liabilities for positive asset balances.
- **Severity:** `Medium`

---

### TC-LAYOUT-06: Dark Mode Contrast Compliance Failure on Critical Legal Disclosures
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - Application Dark Mode active.
- **Execution Steps:**
  1. Inspect legal fee rate footnotes, NAV timestamps, and risk warning notices using an automated contrast analyzer (e.g., axe DevTools).
- **Expected Behavior:**
  - All text meets WCAG 2.1 AA minimum contrast ratio of **4.5:1** (or 3:1 for large text).
- **Defect Hypothesis:**
  - Footnote styling uses muted gray (`#6B7280`) on deep black/navy background (`#111827`), yielding an unreadable contrast ratio of **2.8:1**, violating regulatory mandatory fee disclosure standards.
- **Severity:** `Medium`

---

## 10. Miscellaneous, Edge Operating Environments & System Degradation

### TC-EDGE-01: iOS Low Power Mode Throttling Mid-Calculation of Yield Curve
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Mobile-Specific`
- **Preconditions & Setup State:**
  - Mobile device battery $< 20\%$, Low Power Mode engaged (throttling CPU clock speed by up to 50% and disabling background timers).
- **Execution Steps:**
  1. User opens FMS Interactive 10-Year Monte Carlo Portfolio Simulation.
  2. Complex client-side WASM / JS calculations execute.
- **Expected Behavior:**
  - Heavy simulations are chunked via `requestIdleCallback`, executed in a Web Worker, or offloaded to server-side calculation endpoints to preserve UI thread responsiveness ($\ge 30\text{ fps}$).
- **Defect Hypothesis:**
  - Calculation locks the main JavaScript thread; on throttled hardware, the frame rate drops to 0, triggering an OS "Application Not Responding" (ANR) crash or watchdog termination.
- **Severity:** `Medium`

---

### TC-EDGE-02: OS Biometric / Incoming VoIP Call Interruption During MFA Challenge
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Mobile-Specific`
- **Preconditions & Setup State:**
  - User is executing a $50,000.00 FMS liquidation requiring biometric FaceID / TouchID verification.
- **Execution Steps:**
  1. Biometric prompt appears on screen.
  2. Exactly as the prompt activates, simulate an incoming cellular call or WhatsApp VoIP call, pushing the app into background lifecycle state (`onPause` / `sceneWillResignActive`).
  3. User dismisses call and returns to the app.
- **Expected Behavior:**
  - App restores state securely: re-prompts for biometric authentication without crashing or assuming authentication succeeded/failed prematurely.
- **Defect Hypothesis:**
  - Biometric callback throws an unhandled `SYSTEM_CANCELLED` error. App state machine defaults to an uncaught failure state, locking the user out for 15 minutes due to "maximum failed attempts".
- **Severity:** `Medium`

---

### TC-EDGE-03: OAuth Access Token Expiry Mid-Form Accreditation Submission
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - JWT access token lifetime: 15 minutes.
  - User opens multi-step Accredited Investor Questionnaire (Step 1 of 5).
- **Execution Steps:**
  1. User takes 20 minutes to gather tax documents and fill out extensive inputs across 5 wizard steps.
  2. Access token silently expires.
  3. User clicks final "Submit Verification".
- **Expected Behavior:**
  - HTTP 401 interceptor automatically catches the expired token, pauses the outgoing request, calls `/api/v1/auth/refresh` using the secure HTTP-only refresh token, updates authorization headers, and transparently retries the form payload without clearing form inputs or redirecting to login.
- **Defect Hypothesis:**
  - HTTP 401 interceptor triggers immediate hard redirect to `/login`. All 5 steps of entered financial figures, uploaded document blobs, and inputs are wiped from client memory.
- **Severity:** `High`

---

### TC-EDGE-04: PDF/CSV Tax Export Ledger Reconciliation Mismatch with Dashboard
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User has 1 completed transfer ($1,000.00) and 1 pending in-transit transfer ($500.00) between PMM and FMS at year-end (December 31, 23:55 UTC).
- **Execution Steps:**
  1. View Dashboard Total Asset balance on Jan 1.
  2. Click "Export 2026 Annual Tax Statement (PDF/CSV)".
- **Expected Behavior:**
  - Statement must explicitly delineate:
    - *Settled Cash Balance*
    - *Pending / Unsettled Inter-System Clearances*
    - *Total Carrying Value*
  - Reconciles to the penny with historical audit trail.
- **Defect Hypothesis:**
  - PDF generation service queries only `transactions WHERE status = 'COMPLETED'`, completely omitting the $500.00 pending transfer. Dashboard displays $1,500.00 while the exported tax document states $1,000.00, creating severe tax reporting discrepancy risks.
- **Severity:** `High`

---

### TC-EDGE-05: Service Worker / Cache Storage Desync Serving Stale NAV Charts with Live Balances
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Desktop-Specific`
- **Preconditions & Setup State:**
  - Progressive Web App (PWA) / Electron client caching enabled.
  - Market crashes: NAV drops by 20%.
- **Execution Steps:**
  1. Client app launches after 24 hours in background.
  2. App fetches live cash balance from `/api/v1/pmm/balance` (network-first policy).
  3. Service worker serves cached portfolio allocation pie chart and NAV curve from Cache Storage (cache-first policy).
- **Expected Behavior:**
  - Cache policy for financial data must be strictly `network-first` with immediate revalidation (`stale-while-revalidate` forbidden for valuation charts unless accompanied by a visible "Offline / Cached as of [timestamp]" warning).
- **Defect Hypothesis:**
  - User sees an updated liquid balance alongside a stale, inflated portfolio valuation chart. The aggregated Net Worth calculation on the dashboard adds stale portfolio values to live cash, presenting an incorrect financial position.
- **Severity:** `High`

---

## 11. Test Execution & Coverage Summary Matrix

| ID | Title | Category | Scope | Severity |
|---|---|---|---|---|
| **TC-CONC-01** | Parallel TOCTOU Double-Spend on Liquid Balances | Concurrency & Race Conditions | Global | `Critical` |
| **TC-CONC-02** | Auto-Sweep Millisecond Collision with Card Auth | Concurrency & Race Conditions | Global | `Critical` |
| **TC-CONC-03** | Saga/2PC Partial Network Partition Rollback Failure | Concurrency & Race Conditions | Global | `Critical` |
| **TC-BIZ-01** | Fractional Currency Round-Tripping Arbitrage | Business Rules & Limits | Global | `High` |
| **TC-BIZ-02** | Chargeback on Funds Locked in Illiquid Tranche | Business Rules & Limits | Global | `Critical` |
| **TC-BIZ-03** | Multi-Account KYC Tier Limit Evasion | Business Rules & Limits | Global | `High` |
| **TC-ARITH-01** | Float Drift in Sub-Cent Management Fee Deductions | Arithmetic & Precision | Global | `High` |
| **TC-ARITH-02** | Boundary Attack with NaN and Safe Integer Overflow | Arithmetic & Precision | Global | `Critical` |
| **TC-ARITH-03** | Division by Zero in Initial NAV Calculation | Arithmetic & Precision | Global | `Medium` |
| **TC-NET-01** | Idempotency Key Reuse Under Retry Storm | Network & Async Failures | Global | `Critical` |
| **TC-NET-02** | Stale Delayed Webhook Settling on Shifted NAV | Network & Async Failures | Global | `High` |
| **TC-NET-03** | Half-Open TCP Handshake During Network Handover | Network & Async Failures | Mobile | `Medium` |
| **TC-TIME-01** | Midnight NAV Cut-Off Window Race Condition | Time Zones & Currency | Global | `High` |
| **TC-TIME-02** | Recurring Transfer on Day 31 vs Leap Year | Time Zones & Currency | Global | `Medium` |
| **TC-TIME-03** | DST Fall-Back Dual Execution | Time Zones & Currency | Global | `High` |
| **TC-STATE-01** | Zombie Redemption from Liquidating Fund | State Machine Transitions | Global | `Critical` |
| **TC-STATE-02** | Portfolio Rebalancing Concurrent with Injection | State Machine Transitions | Global | `Critical` |
| **TC-SEC-01** | IDOR in Portfolio Allocation / Sweep Destination | Security & Access Controls | Global | `Critical` |
| **TC-SEC-02** | Parameter Tampering on Management Fee Overrides | Security & Access Controls | Global | `Critical` |
| **TC-UI-01** | Rapid Double-Tap / Click Debounce Bypass | Client-State Sync | Global | `High` |
| **TC-UI-02** | Optimistic UI Desync Allowing Phantom Actions | Client-State Sync | Global | `Medium` |
| **TC-UI-03** | Multi-Tab BroadcastChannel Desynchronization | Client-State Sync | Desktop | `Medium` |
| **TC-LAYOUT-01** | Software Keyboard Pushing CTA Off-Screen | UI Design & Layout | Mobile | `Medium` |
| **TC-LAYOUT-02** | Desktop 150% Scaling Modal Button Clipping | UI Design & Layout | Desktop | `High` |
| **TC-LAYOUT-03** | Proximity Hazard: Cancel Adjacent to Confirm | UI Design & Layout | Global | `Low` |
| **TC-LAYOUT-04** | Large Number Overflow in Dense Ledger Tables | UI Design & Layout | Desktop | `Medium` |
| **TC-LAYOUT-05** | RTL Inversion Bug in Arabic/Hebrew Currency | UI Design & Layout | Global | `Medium` |
| **TC-LAYOUT-06** | Dark Mode Contrast Failure on Legal Footnotes | UI Design & Layout | Global | `Medium` |
| **TC-EDGE-01** | Low Power Mode Throttling Mid-Yield Simulation | Edge Environments | Mobile | `Medium` |
| **TC-EDGE-02** | VoIP Call / FaceID Interruption During MFA | Edge Environments | Mobile | `Medium` |
| **TC-EDGE-03** | Access Token Expiry Mid-Form Submission | Edge Environments | Global | `High` |
| **TC-EDGE-04** | PDF Tax Statement Reconciliation Discrepancy | Edge Environments | Global | `High` |
| **TC-EDGE-05** | Service Worker Serving Stale NAV with Live Cash | Edge Environments | Desktop | `High` |


---

## 12. Deep Mobile-Specific Audit & Codebase Vulnerability Report (Hisaab Production Findings)

### TC-MOB-01: Fingerprint Authentication Intercepted by Google Passkey Credential Manager
- **Category:** Security, Access Controls & IDOR / Mobile UX
- **Platform Scope:** `Mobile-Specific` (Android Chrome, PWA & TWA WebViews)
- **Preconditions & Setup State:**
  - Android device with registered fingerprint hardware.
  - App setting `hisaab.bio_enabled = '1'` configured.
  - User locks app or visits lock screen.
- **Execution Steps:**
  1. Trigger biometric unlock via `#btn-bio` or auto-biometric prompt on launch.
  2. Observe the authentication dialog rendered by the Android OS.
- **Expected Behavior:**
  - The OS must directly display the standard native Android `BiometricPrompt` bottom sheet ("Verify your fingerprint" with native fingerprint sensor icon and instant local sensor callback).
- **Defect Hypothesis:**
  - In `js/core/biometric.js`, the code checks `window.AndroidBridge` (which is undefined in browser/PWA) and immediately falls back to `PublicKeyCredential` (WebAuthn).
  - In modern Android versions, `navigator.credentials.get({ publicKey: ... })` routes through Google Play Services Credential Manager / Google Passkeys.
  - This forces a heavy Google cloud account modal ("Save/Use Passkey with Google Account", cross-device Bluetooth prompt, or cloud passkey selection) rather than a pure, instant local device biometric check. Furthermore, if run under a non-standard scheme or `localhost`, WebAuthn throws a `SecurityError` and permanently blocks unlocking.
- **Severity:** `High`

---

### TC-MOB-02: Collinear Node Skipping & Gesture Ambiguity in 3x3 Pattern Lock
- **Category:** Security, Access Controls & IDOR / Gesture Interaction
- **Platform Scope:** `Mobile-Specific` (Touch Screen Gestures)
- **Preconditions & Setup State:**
  - Lock type set to `pattern`.
  - 3x3 Dot Grid indexed as:
    ```
    [1] [2] [3]
    [4] [5] [6]
    [7] [8] [9]
    ```
- **Execution Steps:**
  1. Touch and hold Dot `1`.
  2. Swipe rapidly to Dot `3`, sweeping through the area between Dot `2` and Dot `5`.
  3. Alternatively, drag in a direct straight line from Dot `1` to Dot `3` across Dot `2` with a fast stroke ($> 150\text{ mm/s}$).
- **Expected Behavior:**
  - In standard Android/iOS pattern lock state machines, if a gesture transitions between two collinear dots (e.g., $1 \to 3$, $4 \to 6$, $7 \to 9$, $1 \to 7$, $2 \to 8$, $3 \to 9$, $1 \to 9$, $3 \to 7$) and the intermediate dot (e.g., Dot `2` between $1$ and $3$) has not yet been selected, the intermediate dot **MUST be automatically claimed and inserted into the active sequence** ($1 \to 2 \to 3$).
- **Defect Hypothesis:**
  - In `js/core/lock.js`, `moveDraw` relies strictly on `checkPointHit(pt)` which checks `Math.hypot(d.x - pt.x, d.y - pt.y) < 26`.
  - There is zero geometric interpolation or collinear bridge detection.
  - If the touch event delta skips the 26px radius of Dot `2`, or if the user gestures through the gap between 2 and 5, Dot `2` is completely skipped, resulting in sequence `[0, 2]` ($1 \to 3$).
  - When the user draws what visually appears to be an identical pattern, subtle variations in swipe curve result in mismatched hash strings, locking the user out of their own finances.
- **Severity:** `High`

---

### TC-MOB-03: Viewport Rubber-Banding, Document Overflow & Unpinned Headers
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Mobile-Specific`
- **Preconditions & Setup State:**
  - User browsing on mobile device (Safari iOS or Chrome Android).
  - Viewing `Overview` (`#/home`) or `History` (`#/history`).
- **Execution Steps:**
  1. In `Overview`, scroll vertically down through fund tiles.
  2. In `History`, scroll through 50+ recorded expense items.
  3. On any screen where content fits within viewport height (e.g., empty state or settings), drag finger up/down on the screen.
- **Expected Behavior:**
  - `html, body` must enforce `overscroll-behavior: none` to eliminate rubber-banding and accidental browser pull-to-refresh.
  - Screens where content fits within 100dvh must lock scroll completely.
  - In `Overview`: Critical summary balance and metrics should remain anchored/pinned, allowing only the fund tiles and list container to scroll.
  - In `History`: The month selector, date navigation arrows, and filter chips must be sticky (`position: sticky; top: 0; z-index: 10`) with backdrop blur so filtering controls never vanish when reviewing past records.
- **Defect Hypothesis:**
  - `base.css` relies on default browser body scrolling (`body { min-height: 100dvh }`) without viewport containment.
  - Neither `dashboard.js` nor `history.js` wrap their lists in dedicated scrollable flex/grid containers with sticky headers. As a result, the entire viewport scrolls away, forcing users to scroll all the way back to the top just to switch months or check liquid totals.
- **Severity:** `Medium`

---

### TC-MOB-04: Broken Backlinks & Inter-Module Navigation Routing Leaks
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User navigates through auxiliary screens: `Recurring` (`#/recurring`), `Statements` (`#/statements`), `Audit` (`#/audit`), `Logs` (`#/logs`), or `Account` (`#/account`).
- **Execution Steps:**
  1. On Desktop: Click `Insights -> Recurring` from the sidebar. Inspect the backlink at top-left.
  2. On Desktop: Click `Tools -> Audit` from the sidebar. Inspect the backlink.
  3. In `Account Profile` (`#/account`): Click the "Choose Chat ID" action button.
- **Expected Behavior:**
  - Navigation headers must respect the true user referrer stack (`window.history.back()` or parent section routing) rather than hardcoded assumptions.
  - Profile setup must guide users through identity configuration, not jump them into the P2P chat conversation list.
- **Defect Hypothesis:**
  - In `recurring.js`, `statements.js`, `audit.js`, `logs.js`, and `manage.js`, headers hardcode `<a class="muted" href="#/settings">< Settings</a>`. When navigated from sidebar or home, clicking back sends the user to the unrelated Settings page.
  - In `account.js` line 52, the profile CTA hardcodes `href="#/chat"` instead of inline handle editing, confusing users.
- **Severity:** `Medium`

---

### TC-MOB-05: Settings Accordion Collapse & Layout Thrashing on Toggle Interaction
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Mobile-Specific` & `Desktop-Specific`
- **Preconditions & Setup State:**
  - User on `#/settings` screen.
  - Expands the "Security & App Lock" or "Alerts & Safety Guards" accordion (`<details>`).
- **Execution Steps:**
  1. Toggle any switch (e.g., "Budget & Spend Notifications", "Sound", or "Biometrics").
  2. Alternatively, switch Layout Mode ("Minimal" / "Detailed") or click "Sync Now".
- **Expected Behavior:**
  - Setting update applies seamlessly in-place; the open `<details>` accordion stays open at the exact same scroll position with zero UI flicker or layout shift.
- **Defect Hypothesis:**
  - In `js/modules/settings.js`, toggles like `mode`, `data-notify`, `data-sync-now`, and lock modifications call `render(root)`.
  - `render(root)` executes `root.innerHTML = ...`, wiping the entire DOM tree and reconstructing it from scratch.
  - Standard HTML `<details class="settings-acc">` elements do not persist their `open` attribute across DOM wipes. The accordion snaps shut instantly, accompanied by a noticeable browser repaint shutter and loss of touch/scroll focus.
- **Severity:** `Medium`

---

### TC-MOB-06: Asynchronous Boot FOUC & Draggable FAB Coordinate Jump on Refresh
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Mobile-Specific` & `Desktop-Specific`
- **Preconditions & Setup State:**
  - User opens or refreshes the application (`Ctrl+R` / mobile reload).
- **Execution Steps:**
  1. Observe the top-left corner of the viewport and main view during the first 200–500ms of boot.
- **Expected Behavior:**
  - Clean initial paint: Floating Action Buttons (FABs) initialize invisibly or at their persisted coordinates; main content renders with a smooth skeleton or immediate layout without popping.
- **Defect Hypothesis:**
  - In `index.html`, `#fab-add` and `#fab-ai` exist in static markup with CSS `top:0; left:0;`.
  - In `js/main.js`, top-level `await store.init()` and `await store.runRecurring()` block module completion before calling `makeDraggable()` and `draw()`.
  - During this async window, the browser renders the FABs pinned to `(0,0)` (top-left over the logo/gear icons). Once JavaScript executes, `makeDraggable` jumps them down to their calculated wall positions, and `draw()` injects the main HTML, causing an unpolished "shutter" / layout flash on every page refresh.
- **Severity:** `Medium`

---

### TC-MOB-07: Plaintext Financial Statement & PII Exfiltration to Third-Party AI
- **Category:** Security, Access Controls & IDOR / Financial Data Privacy
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - User enables custom AI provider in Settings (e.g., Google Gemini API, OpenRouter, or Custom Endpoint).
  - User has active balances, personal funds, funds held for others, and recent transactions.
- **Execution Steps:**
  1. User asks Munimji a question: *"How can I cut expenses this month?"* or *"Log coffee 120"*.
  2. Intercept the outbound HTTPS payload sent to `api.openai.com` / `generativelanguage.googleapis.com`.
- **Expected Behavior:**
  - Financial data privacy standard: Raw personal financial statements, exact liquid wealth, account holder names, email addresses, and merchant notes must NEVER be transmitted unencrypted in raw plaintext to external LLM servers.
- **Defect Hypothesis:**
  - In `js/core/ai.js`, `getFinancialContext()` bundles:
    - User name & email (`ctx.profile`, `ctx.signInStatus`)
    - Exact liquid balances of all accounts (`ctx.totalOwn`, `ctx.fundsSummary`)
    - Money held in trust for third parties (`ctx.totalHeld`, `ctx.heldSummary`)
    - Exact monthly income, expense, and net savings (`ctx.monthIncome`, `ctx.monthExpense`)
    - Exact list of recent transactions with notes and dates
  - This entire payload is injected into `defaultSys` and sent directly to external cloud AI providers without anonymization, synthetic masking, or differential privacy filters.
- **Severity:** `Critical`

---

### TC-MOB-08: Responsive Multi-Column Card Grid Breakage on Mobile Viewports
- **Category:** UI Design, Layout, Component Placement & Visual Integrity
- **Platform Scope:** `Mobile-Specific` (Small to Mid Viewports 320px–480px)
- **Preconditions & Setup State:**
  - User accessing Hisaab on mobile screen (e.g., 360x800 or 390x844).
  - Viewing `Funds` (`#/funds`) or `Metrics` (`#/metrics`).
- **Execution Steps:**
  1. Inspect the card grid layout on the Funds page.
  2. Inspect the ratio cards on the Metrics page.
- **Expected Behavior:**
  - **Funds & Small Cards:** Exactly **2 in a row** across multiple rows on mobile, with balanced padding, truncated names (`ellipsis`), and clean numerical alignment.
  - **Metrics Cards (Savings Rate, Runway Tank, Burn Velocity):** Exactly **1 in a row** (full width) across multiple stacked rows, giving complex visual meters, split columns, and descriptions full breathing space.
- **Defect Hypothesis:**
  - In `css/components.css`, `.grid` uses:
    ```css
    @media(max-width:599px){.grid{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}}
    ```
  - In `metrics.js`, an inline style overrides CSS:
    ```html
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
    ```
  - Using `auto-fit` with arbitrary `minmax` values causes unpredictable column collapsing: on narrow devices (320px–360px), Funds collapse to an awkward single column or overflow; on wider phones (412px–480px), Metrics cards attempt to fit two abreast, squishing liquid tanks and wrapping text numbers awkwardly.
- **Severity:** `Medium`

---

## 13. High-Priority Sister Bugs Discovered in Codebase

### TC-MOB-09: In-Memory Lock Rate Limit Bypassed via Browser Page Refresh
- **Category:** Security, Access Controls & IDOR / Brute-Force Resilience
- **Platform Scope:** `Global / Cross-Platform`
- **Preconditions & Setup State:**
  - App locked with PIN or Pattern.
  - User enters 5 incorrect attempts.
  - Lock screen displays: *"Too many tries. Wait 30s."*
- **Execution Steps:**
  1. Press browser Refresh (`F5` / swipe-to-refresh).
  2. Immediately enter another set of attempts.
- **Expected Behavior:**
  - The lockout penalty timestamp must be stored in `localStorage` or `sessionStorage` (`hisaab.lock_until = Date.now() + 30000`).
  - Refreshing the page must preserve the remaining lockout duration.
- **Defect Hypothesis:**
  - In `js/core/lock.js`, lines 64 & 159–162:
    ```javascript
    let hiddenAt = 0, fails = 0, until = 0;
    // ...
    if (fails >= 5) { until = Date.now() + 30000; fails = 0; }
    ```
  - `fails` and `until` are stored exclusively in in-memory JavaScript variables. Refreshing the page reinitializes them to `0`, completely bypassing the 30-second brute-force throttling mechanism and allowing infinite automated guessing.
- **Severity:** `High`

---

### TC-MOB-10: Unhandled AudioContext Autoplay Rejection on Initial Mobile Touch
- **Category:** Miscellaneous, Edge Operating Environments & System Degradation
- **Platform Scope:** `Mobile-Specific` (iOS Safari & Chrome Android)
- **Preconditions & Setup State:**
  - Tactile Sound enabled (`p.sound = true`).
  - First visit or cold launch.
- **Execution Steps:**
  1. Boot app and tap directly on a toggle or input without a prior generic document touch.
- **Expected Behavior:**
  - The sound manager must lazily resume the `AudioContext` inside a trusted touch event handler or catch `NotAllowedError` silently without console spam or UI freeze.
- **Defect Hypothesis:**
  - In `js/core/sound.js`, browsers strictly restrict Web Audio API until a deliberate user gesture occurs. Calling `playTick()` on automated triggers throws unhandled Promise rejections, degrading performance and polluting error logs.
- **Severity:** `Low`

---

### TC-MOB-11: Hardware Back Button Closes App Instead of Dismissing Sheets/Modals
- **Category:** UI/UX Client-State Synchronization & Interaction Logic
- **Platform Scope:** `Mobile-Specific` (Android Native & PWA)
- **Preconditions & Setup State:**
  - Open Transaction Sheet (`#sheet-root`) or Munimji AI Chat sheet.
- **Execution Steps:**
  1. Tap the physical or gesture Android OS "Back" navigation control.
- **Expected Behavior:**
  - The OS back event must push a history state (`history.pushState({ sheetOpen: true })`).
  - Triggering OS Back should close the active modal/sheet first, keeping the user inside Hisaab.
- **Defect Hypothesis:**
  - Sheets are managed exclusively via DOM mutation (`sheet-root.classList.add('open')`) without synchronizing with browser `history.pushState`.
  - Pressing the Android back button triggers a full window navigation, popping the URL hash or exiting the PWA entirely, discarding unsaved transaction drafts.
- **Severity:** `Medium`

---

## 14. Architectural Solution & Workaround: Zero-Knowledge AI Privacy for Munimji

### The Challenge
Munimji needs enough context to answer accounting queries (e.g., *"How much did I spend on dining out?"* or *"Record 400 for groceries from Cash"*) without exposing real bank account names, exact personal wealth, or sensitive financial notes to third-party AI models (Gemini, OpenAI, OpenRouter).

### Recommended 3-Tier Zero-Knowledge Architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER INPUT PROMPT                               │
│              "Spent 450 on medicines from HDFC Bank"                   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   TIER 1: LOCAL INTENT EXTRACTOR                       │
│    - Regex & Rule-Based Matcher runs 100% on device                    │
│    - If intent is "LOG_TRANSACTION", "BALANCE_QUERY", or "ALERTS":     │
│      -> Handled directly by local calc.js engine with ZERO AI call     │
│      -> Instant response, 0ms latency, zero cloud leakage              │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ (If open-ended advisory question)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│             TIER 2: CLIENT-SIDE PRIVACY MASKING PROXY                  │
│    1. Tokenize Entities:                                               │
│       - Fund names: "HDFC Bank" -> "[Vault_A]", "Cash" -> "[Vault_B]"  │
│       - Category names: Kept generalized ("Healthcare", "Groceries")   │
│       - PII Sanitizer: Regex strips phone numbers, emails, UPI IDs     │
│    2. Dennis-Denominate Balances (Differential Normalization):          │
│       - Replace exact amounts with relative percentages / ratios:      │
│         "Balance: ₹1,42,500" -> "Operating Buffer: 68% of baseline"    │
│         "Expense: ₹42,100"   -> "Monthly Burn: 85% of monthly inflow"  │
│    3. Cloud Prompt Composition:                                        │
│       - Transmit ONLY tokenized abstract financial ratios              │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ (Encrypted HTTPS Payload)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   TIER 3: EXTERNAL LLM INFERENCE                       │
│    - Model reasons over abstract ratios and financial principles       │
│    - Returns advice using placeholders: "[Vault_A]", "85% burn"        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│              LOCAL DETOKENIZATION & RENDER PIPELINE                    │
│    - Device swaps "[Vault_A]" back to "HDFC Bank" in UI display        │
│    - User sees perfectly tailored advice; Cloud AI learned nothing!    │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Implementation Details:
1. **Sanitized Context Structure:**
   Instead of transmitting raw numbers:
   ```json
   {
     "vaults": [{"alias": "Fund_1", "type": "liquid"}, {"alias": "Fund_2", "type": "held_trust"}],
     "cashflow_profile": {
       "savings_status": "Healthy (35% retained)",
       "runway_tier": "3-6 months",
       "top_expense_cluster": "Groceries (40% of outflow)"
     }
   }
   ```
2. **Intent Delegation:**
   - Any prompt containing keywords like `"spent"`, `"paid"`, `"balance of"`, `"kitna bacha"` is intercepted by `localAssistantReply()` on-device. The remote cloud API is only invoked for high-level open financial education.
3. **Opt-in Privacy Switch in Settings:**
   - Provide a toggle in Settings: `"Sanitized AI Mode (Zero Financial Data Shared)"` enabled by default.
