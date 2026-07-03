# Money-logix — API Documentation

REST + WebSocket API for the paper-trading engine. This document is organised
**page by page** (the frontend page → the endpoints it calls), followed by a
**full endpoint reference** and the **data models**.

- **Base URL:** `http://localhost:5000`
- **API prefix:** all REST routes live under `/api`
- **WebSocket:** `ws://localhost:5000/ws/market`

---

## Conventions

### Response envelope
Every REST response is JSON with a `status` field:

```jsonc
// success
{ "status": "success", "data": <object|array>, "results": <number?> }
// error
{ "status": "fail" | "error", "message": "<human readable>" }
```

`results` is present only on list endpoints (equals `data.length`).
`status` is `"fail"` for 4xx (client) errors and `"error"` for 5xx (server) errors.

### Authentication
Auth uses **JWT bearer tokens**. Obtain a token from `POST /api/auth/register` or
`POST /api/auth/login`, then send it on protected routes:

```
Authorization: Bearer <token>
```

Protected routes are everything under **`/api/me/*`**. Missing/invalid/expired
tokens return **401**. The user is always taken from the token — never from the
request body or URL.

The frontend persists the token in `localStorage["mlx.token"]`; an axios
interceptor attaches it to every request and, on any 401, clears it and redirects
to `/login`.

### Common status codes
| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created (register, order placed) |
| 400 | Validation error (bad/missing fields, bad UUID) |
| 401 | Not authenticated (missing/invalid/expired token, bad credentials) |
| 404 | Resource not found |
| 409 | Conflict (duplicate email/username) |
| 422 | Business rule violation (insufficient funds/holdings, unpriced asset) |

---

# Part 1 — Page-by-page

## Register — `/register`
Creates an account and logs in immediately.

| Action | Endpoint |
|---|---|
| Submit form | [`POST /api/auth/register`](#post-apiauthregister) |

On success the returned `token` is stored and the user is redirected to `/`.

## Login — `/login`
| Action | Endpoint |
|---|---|
| Submit form | [`POST /api/auth/login`](#post-apiauthlogin) |

## App shell (auth bootstrap)
On load, if a token is already stored, `AuthContext` hydrates the current user and
`RequireAuth` gates every app route.

| Action | Endpoint |
|---|---|
| Hydrate current user | [`GET /api/me`](#get-apime) |

## Dashboard — `/`
Shows the authenticated user's cash, equity and ROI.

| Action | Endpoint |
|---|---|
| Load portfolio summary | [`GET /api/me/portfolio`](#get-apimeportfolio) |

## Market — `/market`
The live trading view: price list, candlestick chart, and a Buy/Sell panel.

| UI region | Action | Endpoint |
|---|---|---|
| Price list + live price | Stream latest ticks | [`WS /ws/market`](#websocket-wsmarket) |
| Chart | Load candle history | [`GET /api/market/candles`](#get-apimarketcandles) |
| Trade panel | Place a Buy/Sell order | [`POST /api/me/orders`](#post-apimeorders) |

> The price list is populated entirely from the WebSocket tick stream. The REST
> `GET /api/market/prices` endpoint returns the same latest-price snapshot and is
> available if a non-streaming load is preferred.

## Leaderboard — `/leaderboard`
> **Current state:** the page is a stub. The backing endpoint is live and ready to
> wire up.

| Action | Endpoint |
|---|---|
| Load ranked users | [`GET /api/leaderboard`](#get-apileaderboard) |

## Profile — `/profile`
> **Current state:** the page is a stub. The authenticated per-user endpoints below
> are the natural data sources.

| Candidate data | Endpoint |
|---|---|
| Wallet balance | [`GET /api/me/wallet`](#get-apimewallet) |
| Holdings | [`GET /api/me/positions`](#get-apimepositions) |
| Order history | [`GET /api/me/orders`](#get-apimeorders) |
| Panic-button reset | [`POST /api/me/reset`](#post-apimereset) |

---

# Part 2 — Endpoint reference

## Auth

### `POST /api/auth/register`
Create an account (also provisions a wallet with the $100,000 starting balance) and
return a token. **No auth required.**

**Request body**
```json
{ "username": "trader1", "email": "trader1@example.com", "password": "password123" }
```
- `password` must be **≥ 8 characters**.

**201 Created**
```json
{
  "status": "success",
  "data": {
    "user": { "id": "uuid", "username": "trader1", "email": "trader1@example.com", "created_at": "2026-07-03T..." },
    "token": "<jwt>"
  }
}
```

**Errors:** `400` (missing fields / password < 8), `409` (email already registered).

---

### `POST /api/auth/login`
Verify credentials and return a token. **No auth required.**

**Request body**
```json
{ "email": "trader1@example.com", "password": "password123" }
```

**200 OK** — same `{ user, token }` shape as register.

**Errors:** `400` (missing fields), `401` (`Invalid email or password.` — generic; also returned for legacy password-less users).

---

## Me (authenticated)
All routes below require `Authorization: Bearer <token>`. The user is resolved from
the token.

### `GET /api/me`
Return the authenticated user.
```json
{ "status": "success", "data": { "user": { "id": "uuid", "username": "trader1", "email": "trader1@example.com", "created_at": "..." } } }
```

### `GET /api/me/wallet`
```json
{ "status": "success", "data": { "id": "uuid", "user_id": "uuid", "balance": "100000.0000", "updated_at": "..." } }
```

### `GET /api/me/positions`
Open holdings (quantity > 0), valued at the latest price.
```json
{
  "status": "success",
  "results": 1,
  "data": [
    {
      "symbol": "AAPL",
      "quantity": "2.0000",
      "averageBuyPrice": "195.0000",
      "currentPrice": "195.0000",
      "marketValue": "390.0000",
      "costBasis": "390.0000",
      "unrealizedPnl": "0.0000",
      "unrealizedPnlPct": "0.0000"
    }
  ]
}
```
> For an unpriced holding (no market price), `currentPrice`, `marketValue`,
> `unrealizedPnl` and `unrealizedPnlPct` are `null`.

### `GET /api/me/portfolio`
Full valuation snapshot.
```json
{
  "status": "success",
  "data": {
    "cashBalance": "98050.0000",
    "holdingsValue": "1950.0000",
    "totalEquity": "100000.0000",
    "totalCostBasis": "1950.0000",
    "totalUnrealizedPnl": "0.0000",
    "totalUnrealizedPnlPct": "0.0000",
    "roiPct": "0.0000",
    "startingCapital": "100000.0000",
    "unpricedSymbols": [],
    "positions": [ /* same shape as /me/positions */ ]
  }
}
```

### `GET /api/me/orders`
Order history (most recent first).
```json
{
  "status": "success",
  "results": 1,
  "data": [
    { "id": "uuid", "order_type": "MARKET", "side": "BUY", "quantity": "2.0000", "target_price": null, "status": "FILLED", "created_at": "...", "symbol": "AAPL" }
  ]
}
```

### `POST /api/me/orders`
Place an order for the authenticated user.

**Market order — request body**
```json
{ "symbol": "AAPL", "side": "BUY", "quantity": 2 }
```
**201 Created**
```json
{
  "status": "success",
  "data": {
    "order": { "id": "uuid", "order_type": "MARKET", "side": "BUY", "quantity": "2.0000", "status": "FILLED", "...": "..." },
    "transaction": { "id": "uuid", "transaction_type": "BUY", "amount": "390.0000", "price_per_share": "195.0000", "...": "..." },
    "wallet": { "balance": "99610.0000", "...": "..." },
    "executedPrice": "195.0000",
    "totalAmount": "390.0000"
  }
}
```

**Limit order — request body**
```json
{ "symbol": "AAPL", "side": "BUY", "quantity": 2, "orderType": "LIMIT", "targetPrice": "180.0000" }
```
**201 Created** — rests as `PENDING`, filled later by the tick-driven matcher:
```json
{ "status": "success", "data": { "order": { "id": "uuid", "order_type": "LIMIT", "status": "PENDING", "target_price": "180.0000", "...": "..." } } }
```

- `side`: `BUY` | `SELL`; `quantity` > 0; LIMIT requires a positive `targetPrice`, MARKET must omit it.

**Errors:** `400` (validation / bad `orderType`), `404` (unknown symbol), `422` (insufficient funds or holdings, or unpriced asset for a market order).

### `DELETE /api/me/orders/:id`
Cancel one of the authenticated user's **PENDING** orders.
```json
{ "status": "success", "data": { "id": "uuid", "status": "CANCELLED" } }
```
**Errors:** `404` (not found / not owned by caller), `409` (`Only pending orders can be cancelled.`).

### `POST /api/me/reset`
Panic button: liquidate positions, cancel pending orders, restore the wallet to
$100,000. Appends one append-only `RESET` ledger row per liquidated position; the
prior BUY/SELL history is preserved. Idempotent on a clean account. No request body.
```json
{
  "status": "success",
  "data": {
    "wallet": { "balance": "100000.0000", "...": "..." },
    "positionsLiquidated": 2,
    "ordersCancelled": 1,
    "resetTransactions": [ { "transaction_type": "RESET", "amount": "1950.0000", "price_per_share": "195.0000", "order_id": null, "...": "..." } ]
  }
}
```

---

## Market
Public, no auth required.

### `GET /api/market/prices`
Latest price for every asset.
```json
{ "status": "success", "results": 3, "data": [ { "symbol": "AAPL", "price": "195.0000", "updatedAt": "..." } ] }
```

### `GET /api/market/prices/:symbol`
```json
{ "status": "success", "data": { "symbol": "AAPL", "price": "195.0000", "updatedAt": "..." } }
```
`data` is `null` if the symbol has no price.

### `GET /api/market/candles`
OHLC candles aggregated on-read from tick history.

**Query params**
| Param | Required | Notes |
|---|---|---|
| `symbol` | yes | e.g. `AAPL` |
| `interval` | no | bucket size in seconds (default 15) |
| `from` / `to` | no | ISO timestamps; default is a recent window |

**200 OK**
```json
{
  "status": "success",
  "data": {
    "symbol": "AAPL",
    "intervalSec": 60,
    "candles": [ { "time": "2026-07-03T14:00:00.000Z", "open": "195.0000", "high": "195.5000", "low": "194.8000", "close": "195.2000" } ]
  }
}
```
**Errors:** `400` (missing `symbol`, bad `interval`, or a range that exceeds the max bucket count).

---

## Leaderboard
Public, no auth required.

### `GET /api/leaderboard`
Users ranked by total equity (equivalently ROI, since every account starts at $100k
with no deposits).

**Query params:** `limit` (optional; default 50, integer 1–200).

**200 OK**
```json
{
  "status": "success",
  "results": 2,
  "data": [
    { "rank": 1, "userId": "uuid", "username": "trader1", "totalEquity": "101050.0000", "roiPct": "1.0500", "hasUnpricedHoldings": false },
    { "rank": 2, "userId": "uuid", "username": "trader2", "totalEquity": "100000.0000", "roiPct": "0.0000", "hasUnpricedHoldings": false }
  ]
}
```
**Errors:** `400` (`limit` not an integer in 1–200).

---

## WebSocket — `ws://localhost:5000/ws/market`
Push-only stream of trade ticks for all active symbols. No auth. The server emits
JSON tick frames; non-tick frames should be ignored by clients.

**Tick frame**
```json
{ "type": "tick", "symbol": "AAPL", "price": "195.1200", "ts": "2026-07-03T14:00:01.000Z" }
```
Source is the Finnhub live feed when the US market is open and a key is set,
otherwise a simulated random walk (a tick every ~2s).

---

## Legacy / dev endpoints (unauthenticated, non-production only)
These predate auth and trust a client-supplied `userId`. They are mounted **only
when `NODE_ENV !== production`** — in production they are not registered and return
`404`, leaving the authenticated `/api/me/*` surface as the only user-scoped API.
**Prefer the `/api/me/*` equivalents**; fully removing these is a tracked backlog
item.

| Method & Path | Notes |
|---|---|
| `POST /api/users` | Create a password-less "dev" user (`{username, email}`) — cannot log in |
| `GET /api/users` | List users |
| `GET /api/users/:id` | Get a user |
| `GET /api/users/:id/wallet` | Wallet by id |
| `GET /api/users/:id/positions` | Positions by id |
| `GET /api/users/:id/portfolio` | Portfolio by id |
| `POST /api/users/:id/reset` | Reset by id (same behaviour as `/api/me/reset`) |
| `POST /api/orders` | Place order (`{userId, symbol, side, quantity, orderType?, targetPrice?}`) |
| `GET /api/orders/user/:userId` | Orders by user |
| `DELETE /api/orders/:id?userId=` | Cancel a pending order |

### `GET /api/health`
Liveness probe: `{ "status": "UP", "message": "Trading engine is running." }`.

---

# Part 3 — Data models & enums

**Money / prices / quantities** are strings at 4 decimal places (backed by
`DECIMAL(15,4)`), e.g. `"195.0000"`. Starting capital is `"100000"`.

| Field | Enum |
|---|---|
| `order_type` | `MARKET`, `LIMIT` |
| `side` | `BUY`, `SELL` |
| `status` (order) | `PENDING`, `FILLED`, `CANCELLED`, `REJECTED` |
| `transaction_type` (ledger) | `BUY`, `SELL`, `DEPOSIT`, `RESET` |

**Order lifecycle**
- MARKET → `FILLED` immediately (or `422` if funds/holdings insufficient).
- LIMIT → `PENDING`, then `FILLED` when price crosses the target (BUY at price ≤ target, SELL at price ≥ target), or `REJECTED` on a funds/holdings shortfall at fill time, or `CANCELLED` via cancel.

**Ledger** is append-only (enforced by a DB trigger): rows are only ever inserted.

---

## Environment
- `NODE_ENV` — set to `production` in deployment. This drops the legacy
  `/api/users` and `/api/orders` dev routes and makes `JWT_SECRET` mandatory.
- `JWT_SECRET` — signs auth tokens (HS256). **Required in production** (the server
  refuses to sign tokens without it); a warned dev fallback is used only when
  `NODE_ENV !== production`.
- `DATABASE_URL`, `FINNHUB_API_KEY` (optional) — see `backend/.env.example`.
