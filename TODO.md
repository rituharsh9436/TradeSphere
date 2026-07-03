# 📋 Project TODO — Paper Trading & Virtual Portfolio Engine

Progress tracker for the backend build. See `product_description.md` for the full
product spec and `backend/tests/scenario.test.js` for the integration suite.

**Legend:** ✅ done · 🚧 in progress · ⬜ not started

_Last updated: 2026-07-03 (Step 10 complete)_

---

## ✅ Step 1 — Foundation & tooling
- [x] Fix `init-db.js` schema typo (`created._at` → `created_at`) that aborted migration
- [x] Make migration idempotent (`CREATE TABLE IF NOT EXISTS`)
- [x] Make migration fail loudly (`process.exitCode = 1` on error)
- [x] Add npm scripts: `start`, `dev`, `db:init`

## ✅ Step 2 — Schema hardening
- [x] CHECK enums on `asset_class`, `order_type`, `side`, `status`, `transaction_type`
- [x] `check_limit_has_target` constraint (LIMIT needs price, MARKET must not)
- [x] New `market_prices` table (price source for valuation & limit triggers)
- [x] Indexes on hot paths (orders, transactions, positions)
- [x] Append-only enforcement on `transactions` via DB trigger (rejects UPDATE/DELETE)
- [x] Seed initial prices (AAPL=195, MSFT=430, TSLA=250)

## ✅ Step 3 — Layered architecture
- [x] `routes → controllers → services → repositories` separation
- [x] Central error handler (maps PG codes: 23505→409, 23514/23502→400, 22P02→400)
- [x] `AppError`, `catchAsync`, `withTransaction` utilities
- [x] Users + Wallet vertical slice
- [x] Endpoints: `POST /api/users`, `GET /api/users/:id`, `GET /api/users/:id/wallet`

## ✅ Step 4 — Market order engine
- [x] `order.service` with atomic `withTransaction` + `SELECT … FOR UPDATE` wallet lock
- [x] `decimal.js` money math (4 dp); quantity-weighted average buy price
- [x] Atomic write of wallet + position + order(FILLED) + ledger row
- [x] Endpoints: `POST /api/orders`, `GET /api/orders/user/:userId`
- [x] Verified: overdraft protection, oversell protection under concurrency

## ✅ Testing
- [x] Integration suite (`npm test`, Node built-in runner, no deps) — 9 cases green
- [x] Edge cases: funds, holdings, symbol, quantity, malformed/nonexistent IDs
- [x] Concurrency invariants: no lost updates, overdraft cap, oversell cap
- [x] Ledger ↔ wallet ↔ positions reconciliation

---

## ✅ Step 5 — Portfolio valuation
- [x] `GET /api/users/:id/positions` — valued holdings (tests now use this, not DB)
- [x] `GET /api/users/:id/portfolio` — cash + holdings × live price → equity, P/L, ROI
- [x] `portfolio.service` + `portfolio.repository` (single positions⋈prices join)
- [x] Unpriced-asset handling (`unpricedSymbols`, excluded from totals)
- [x] Tests (`tests/portfolio.test.js`) — valuation, P/L on price move, ROI,
      totals reconciliation, unpriced asset, 404/400 paths (6 cases, suite now 15)

## 🚧 Step 6 — Market price ingestion
### ✅ Step 6a — Backend ingestion & streaming
- [x] `price_history` ticks table + index; `market_prices` stays latest-only
- [x] Tick sources: Finnhub trades WebSocket + simulated random-walk fallback
- [x] Market-hours/key selector (live when open + keyed, else simulator)
- [x] Ingestion worker: upsert latest + append history (throttled) + WS broadcast
- [x] Browser-facing WebSocket (`/ws/market`) pushing live ticks
- [x] `GET /api/market/prices`, `/prices/:symbol`, `/candles` (on-read OHLC)
- [x] Server lifecycle wiring + graceful shutdown; `.env.example`
### ✅ Step 6b — Frontend live candlestick chart
- [x] Candlestick chart (lightweight-charts) consuming `/candles` + WS
- [x] Timeframe switcher (15s/1m/5m/1h); live-forming candle from the WS tick stream
- [x] Rebuilt Market page: live price list + chart + Buy/Sell (dev active user)

## ✅ Step 7 — Limit orders
- [x] Accept LIMIT orders (status `PENDING`, store `target_price`) via `POST /api/orders`
- [x] Tick-driven matcher: fill PENDING limits at target when price crosses (BUY ≤, SELL ≥); insufficient → REJECTED
- [x] `DELETE /api/orders/:id` — cancel a pending order
- [x] Tests: fill-on-cross, reject, idempotency, cancel, validation

## ✅ Step 8 — Leaderboard & ranking
- [x] `GET /api/leaderboard?limit=` ranked by total equity (= ROI order; $100k start)
- [x] Single aggregation query (users ⋈ wallets ⋈ positions ⋈ market_prices), indexed joins
- [x] Entries: rank, userId, username, totalEquity, roiPct, hasUnpricedHoldings
- [x] Tests: ordering, ROI, unpriced flag, limit cap, validation

## ✅ Step 9 — Reset / restart ("panic button")
- [x] `POST /api/users/:id/reset` — liquidate positions, cancel pending orders, restore wallet to $100,000
- [x] Atomic (one transaction, wallet locked FOR UPDATE); serializes against order fills
- [x] Append-only audit trail: one `RESET` ledger row per position (valued at market, fallback avg buy price)
- [x] Idempotent / no-op safe on a clean account
- [x] Tests: full-reset invariants, unpriced fallback, no-op, ledger preservation, 404

## ✅ Step 10 — Authentication & accounts
- [x] JWT bearer strategy; hashing (scrypt) + signing (HS256) via built-in `crypto` — no new deps
- [x] `password_hash` on users (nullable; legacy dev users stay password-less)
- [x] `POST /api/auth/register`, `POST /api/auth/login`; `requireAuth` middleware
- [x] Token-scoped `/api/me/*` (wallet/positions/portfolio/orders/reset)
- [x] Frontend: AuthContext + login/register, axios token interceptors, retired dev active-user bridge
- [x] Tests: crypto utils, register/login, requireAuth, /api/me scoping (existing 57 still green)

---

## 🔧 Cross-cutting / backlog
- [ ] Lock down / remove legacy unauthenticated `/api/users/*` + `/api/orders` (superseded by `/api/me/*`)
- [ ] Input validation layer (e.g. schema validation middleware)
- [ ] Request logging & structured error logging
- [ ] `.env.example` committed; document required env vars
- [ ] `docs/architecture.md` (data-flow + layer responsibilities)
- [ ] CI workflow to run `npm test` on push
- [ ] Rate limiting / basic security headers
- [ ] API documentation (OpenAPI / README endpoint table)
