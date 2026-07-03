# 📈 Money-logix — Paper Trading & Virtual Portfolio Engine

A risk-free, realistic stock-trading simulator. Users get a virtual cash balance,
place **market** and **limit** orders against **live market prices**, and track
portfolio value, P/L, ROI and a competitive leaderboard — with an immutable,
audit-ready financial ledger underneath.

The engine is built for correctness under concurrency: every money-moving
operation runs in a single SQL transaction with explicit row-level locks, all
money math uses `decimal.js` (no floating-point drift), and the `transactions`
ledger is append-only, enforced at the database level.

> See [`product_description.md`](./product_description.md) for the full product
> spec and [`docs/api.md`](./docs/api.md) for the complete API reference.

---

## Table of contents

- [Features](#-features)
- [Tech stack](#-tech-stack)
- [Repository layout](#-repository-layout)
- [Architecture](#-architecture)
- [Getting started](#-getting-started)
- [Environment variables](#-environment-variables)
- [Database schema](#-database-schema)
- [API overview](#-api-overview)
- [Authentication](#-authentication)
- [Testing](#-testing)
- [Security notes](#-security-notes)
- [Project status](#-project-status)

---

## ✨ Features

- **Accounts & auth** — register/login with JWT bearer tokens; passwords hashed
  with scrypt. No third-party auth dependencies (Node `crypto` only).
- **Virtual wallet** — every account is provisioned with a **$100,000** starting
  balance in one transaction alongside the user (a user can never exist without a
  wallet).
- **Market & limit orders** — market orders fill immediately at the current price;
  limit orders rest as `PENDING` and are filled by a tick-driven matcher when the
  price crosses the target (BUY at price ≤ target, SELL at price ≥ target).
- **Live-price portfolio valuation** — cash + holdings valued at the latest price,
  with cost basis, unrealized P/L and ROI vs. starting capital.
- **Live market data** — Finnhub trades WebSocket when the US market is open (and a
  key is set), otherwise a simulated random-walk feed. Ticks are broadcast to the
  browser over a WebSocket and persisted for on-read candlestick aggregation.
- **Leaderboard** — users ranked by total equity (equivalently ROI, since every
  account starts at $100k with no deposits).
- **Reset ("panic button")** — atomically liquidate positions, cancel pending
  orders, and restore the wallet to $100,000, appending a `RESET` ledger row per
  liquidated position.
- **Immutable ledger** — the `transactions` table rejects `UPDATE`/`DELETE` via a
  database trigger, guaranteeing a pristine audit trail.

---

## 🛠 Tech stack

| Layer | Technology |
| :--- | :--- |
| **Backend runtime** | Node.js (plain CommonJS, no TypeScript) |
| **Web framework** | Express 5 |
| **Database** | PostgreSQL (ACID transactions, `SELECT … FOR UPDATE` row locks, CHECK constraints, triggers) |
| **DB client** | `pg` (node-postgres) with connection pooling |
| **Money math** | `decimal.js` (fixed 4-dp `DECIMAL(15,4)`) |
| **Realtime** | `ws` (WebSocket) — Finnhub ingest + browser broadcast |
| **Auth** | JWT (HS256) + scrypt hashing, built on Node `crypto` |
| **Frontend** | React 19, React Router 7, Vite 8, Tailwind CSS 4, axios, `lightweight-charts` |
| **Tests** | Backend: Node built-in test runner. Frontend: Vitest |

---

## 📁 Repository layout

```
Money-logix-project/
├── backend/                     # Node + Express + PostgreSQL API
│   ├── src/
│   │   ├── app.js               # Express app (middleware, routes, error handler)
│   │   ├── server.js            # HTTP server + market-data runtime bootstrap
│   │   ├── config/              # DB pool
│   │   ├── routes/              # Route definitions (thin)
│   │   ├── controllers/         # HTTP adapters (req/res)
│   │   ├── services/            # Business logic (transactions, validation)
│   │   ├── repositories/        # SQL data access
│   │   ├── middleware/          # requireAuth, error handler
│   │   ├── marketdata/          # Tick sources, ingestion worker, WS, runtime
│   │   ├── utils/               # AppError, catchAsync, withTransaction, token, password
│   │   └── scripts/             # init-db / reset-db
│   ├── tests/                   # Integration + unit tests (node:test)
│   └── .env.example
├── paper-trading-ui/            # React (Vite) frontend
│   └── src/
│       ├── pages/               # Dashboard, Market, Leaderboard, Profile, Login, Register
│       ├── components/          # Chart, PriceList, TradePanel, Navbar, RequireAuth, …
│       ├── context/             # AuthContext
│       ├── services/            # axios api client, authApi, marketApi, marketSocket
│       ├── hooks/               # useMarketData
│       └── lib/                 # authStorage, candles (+ unit tests)
├── docs/api.md                  # Full REST + WebSocket API reference
├── product_description.md       # Product spec
└── TODO.md                      # Step-by-step build tracker
```

---

## 🏗 Architecture

**Layered (clean) architecture** — a request flows strictly one direction:

```
routes → controllers → services → repositories → PostgreSQL
```

- **Controllers** are thin: parse the request, call a service, shape the response.
- **Services** own business rules and wrap multi-step writes in a single
  transaction via `utils/withTransaction`.
- **Repositories** are the only place raw SQL lives; every method optionally
  accepts a transaction `client` so callers can enlist it.

**Concurrency & integrity**

- Money-moving operations lock the user's wallet row `FOR UPDATE`, serializing
  concurrent orders from the same user so the account can never over-draft or
  over-sell.
- All monetary values are `decimal.js` at 4 decimal places, matching the
  `DECIMAL(15,4)` schema.
- The `transactions` ledger is append-only, enforced by a `BEFORE UPDATE OR DELETE`
  trigger that raises an exception — the guarantee holds regardless of application
  code.

**Market-data pipeline** (`backend/src/marketdata`)

- A **tick source** feeds prices: the Finnhub live WebSocket when the US market is
  open and `FINNHUB_API_KEY` is set, otherwise a simulated random walk (~1 tick/2s).
- The **ingestion worker** upserts the latest price into `market_prices`, appends
  the tick to `price_history` (throttled), triggers any crossed LIMIT orders, and
  broadcasts the tick to browsers over `ws://…/ws/market`.
- Candlesticks are aggregated **on read** from `price_history` by the
  `/api/market/candles` endpoint.

**Error handling** — controllers/services throw `AppError(message, statusCode)`;
a central error handler maps common Postgres error codes to clean responses
(`23505 → 409`, `23514/23502 → 400`, `22P02 → 400`).

---

## 🚀 Getting started

### Prerequisites

- **Node.js** 18+ (uses the built-in test runner and `base64url`)
- **PostgreSQL** 13+ (uses `gen_random_uuid()`)

### 1. Backend

```bash
cd backend
npm install

# Configure environment
cp .env.example .env
#   → set DATABASE_URL, JWT_SECRET (and optionally FINNHUB_API_KEY)

# Create the schema and seed assets/prices (AAPL=195, MSFT=430, TSLA=250)
npm run db:reset      # = db:drop + db:init

# Run the API + market-data pipeline
npm run dev           # nodemon (auto-reload)   → http://localhost:5000
# or
npm start
```

Verify it's up: `GET http://localhost:5000/api/health` → `{ "status": "UP" }`.

### 2. Frontend

```bash
cd paper-trading-ui
npm install
npm run dev           # Vite dev server (default http://localhost:5173)
```

The frontend expects the backend at `http://localhost:5000/api` (see
`paper-trading-ui/src/services/api.js`).

---

## 🔧 Environment variables

Configured in `backend/.env` (see `backend/.env.example`):

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `PORT` | no | API port (default `5000`) |
| `NODE_ENV` | prod | Set to `production` to disable the legacy dev routes and **require** `JWT_SECRET` |
| `JWT_SECRET` | **prod** | Signs JWT auth tokens (HS256). Required in production; a warned dev fallback is used only when `NODE_ENV !== production` |
| `FINNHUB_API_KEY` | no | Enables the live trades feed during US market hours; unset → simulated feed |
| `MARKET_TICK_INTERVAL_MS` | no | Simulator tick cadence (default `2000`) |
| `MARKET_DEFAULT_CANDLE_SEC` | no | Default candle bucket seconds (default `15`) |
| `MARKET_HISTORY_THROTTLE_MS` | no | Min gap between per-symbol history writes (default `1000`) |

---

## 🗄 Database schema

Created by `backend/src/scripts/init-db.js` (idempotent):

| Table | Purpose |
| :--- | :--- |
| `users` | Accounts; `password_hash` is nullable (legacy dev users are password-less) |
| `wallets` | One per user; `balance DECIMAL(15,4)`, `CHECK (balance >= 0)`, defaults to `100000` |
| `assets` | Tradable instruments (seeded: AAPL, MSFT, TSLA) |
| `orders` | MARKET/LIMIT orders; status `PENDING`/`FILLED`/`CANCELLED`/`REJECTED`; CHECK ties `target_price` to LIMIT |
| `transactions` | **Append-only** ledger (`BUY`/`SELL`/`DEPOSIT`/`RESET`), enforced by trigger |
| `positions` | Per-user holdings, unique on `(user_id, asset_id)`, `average_buy_price` |
| `market_prices` | Latest price per asset (valuation + limit triggering) |
| `price_history` | Every tick (append-only), source for candle aggregation |

Money, prices and quantities are returned as **strings at 4 decimals**
(e.g. `"195.0000"`).

---

## 🔌 API overview

Base URL `http://localhost:5000`, all REST routes under `/api`, WebSocket at
`ws://localhost:5000/ws/market`. Every REST response is a `{ status, data, … }`
envelope. **Full reference: [`docs/api.md`](./docs/api.md).**

| Area | Endpoints |
| :--- | :--- |
| **Auth** (public) | `POST /api/auth/register`, `POST /api/auth/login` |
| **Me** (auth required) | `GET /api/me`, `GET /api/me/wallet`, `GET /api/me/positions`, `GET /api/me/portfolio`, `GET /api/me/orders`, `POST /api/me/orders`, `DELETE /api/me/orders/:id`, `POST /api/me/reset` |
| **Market** (public) | `GET /api/market/prices`, `GET /api/market/prices/:symbol`, `GET /api/market/candles` |
| **Leaderboard** (public) | `GET /api/leaderboard?limit=` |
| **Realtime** | `WS /ws/market` — push-only tick stream |
| **Health** | `GET /api/health` |

**Order lifecycle**

- **MARKET** → `FILLED` immediately, or `422` on insufficient funds/holdings (or an
  unpriced asset).
- **LIMIT** → `PENDING`, then `FILLED` when the price crosses the target, `REJECTED`
  on a shortfall at fill time, or `CANCELLED` via `DELETE`.

---

## 🔐 Authentication

- Register or log in to receive a **JWT bearer token**. Send it as
  `Authorization: Bearer <token>` on every `/api/me/*` route.
- **The acting user is always taken from the verified token** — never from the
  request body or URL. Missing/invalid/expired tokens return `401`.
- Tokens are HS256, signed with `JWT_SECRET`, and expire after 7 days.
- Passwords are hashed with **scrypt** (stored as `scrypt$<salt>$<key>`) and
  verified in constant time.
- The frontend persists the token in `localStorage["mlx.token"]`; an axios
  interceptor attaches it to every request and, on any `401`, clears it and
  redirects to `/login`.

---

## 🧪 Testing

**Backend** — Node's built-in runner; requires a reachable database. Reset the
schema first for a clean, collision-free run:

```bash
cd backend
npm run db:reset
npm test              # node --test, concurrency 1
```

Covers crypto utils, register/login, `requireAuth`, `/api/me/*` scoping, the market
order engine (including concurrency: overdraft/oversell caps, no lost updates),
portfolio valuation, limit-order fill/reject/cancel, leaderboard, reset, and
ledger↔wallet↔positions reconciliation.

**Frontend**

```bash
cd paper-trading-ui
npm test              # vitest run
```

---

## 🛡 Security notes

- **`JWT_SECRET` fails closed in production.** When `NODE_ENV=production` and the
  secret is unset, the server refuses to sign/verify tokens rather than falling back
  to an insecure hardcoded dev secret.
- **Legacy dev routes are production-gated.** The pre-auth `/api/users` and
  `/api/orders` routes (which trust a client-supplied `userId`) are mounted **only
  when `NODE_ENV !== production`**. In production the authenticated `/api/me/*`
  surface is the only user-scoped API. Retire them entirely to fully close the
  surface (tracked in [`TODO.md`](./TODO.md)).
- **Login is constant-work.** Login always runs one scrypt verification (against a
  dummy hash when the email is unknown) so response timing does not reveal whether
  an email is registered.

---

## 📌 Project status

Backend Steps 1–10 are complete (foundation, schema hardening, layered
architecture, market orders, portfolio valuation, market-data ingestion + live
chart, limit orders, leaderboard, reset, and authentication). See
[`TODO.md`](./TODO.md) for the detailed tracker and remaining backlog
(input-validation layer, request logging, CI, rate limiting, OpenAPI).
