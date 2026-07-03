# Architecture

How Money-logix is put together: the layers a request flows through, how money
integrity is guaranteed under concurrency, and how live prices move through the
system. Pairs with [`api.md`](./api.md) (the external contract) and the code under
`backend/src`.

---

## 1. Layered request lifecycle

Every REST request flows strictly one direction. Nothing skips a layer, and
dependencies only ever point downward:

```
HTTP request
   │
   ▼
routes/           declare paths + attach middleware (auth, validate, rate limit)
   │
   ▼
controllers/      thin HTTP adapters: read req, call one service, shape the response
   │
   ▼
services/         business logic; own transactions and all business rules
   │
   ▼
repositories/     the only place raw SQL lives; each method accepts an optional client
   │
   ▼
PostgreSQL
```

**Layer responsibilities**

| Layer | Does | Never does |
|---|---|---|
| `routes/` | Path → middleware → controller wiring | Business logic |
| `controllers/` | Parse request, call a service, format `{status,data}` | Talk to the DB, enforce rules |
| `services/` | Validation, orchestration, transactions, locking | Touch `req`/`res` |
| `repositories/` | Parameterized SQL, return plain rows | Business decisions |

**Cross-cutting middleware** (registered in `src/app.js`, in order):
`requestLogger` → `helmet` → `cors` → `express.json` → `/api/health` +
`/api/openapi.json` → `apiLimiter` + the API router → `notFound` → `errorHandler`.

**Shared utilities** (`src/utils`)
- `catchAsync` — wraps async handlers so rejections reach the error handler.
- `AppError(message, statusCode)` — operational error carrying an HTTP status.
- `withTransaction(fn)` — runs `fn(client)` inside `BEGIN`/`COMMIT`, rolling back
  on throw; the single entry point for multi-step writes.

**Error handling.** Services/controllers throw `AppError`; `middleware/errorHandler`
translates it (and common Postgres codes — `23505 → 409`, `23514/23502 → 400`,
`22P02 → 400`) into the standard envelope, and logs 5xx/unexpected errors as
structured JSON. `status` is `fail` for 4xx and `error` for 5xx.

---

## 2. Money integrity & concurrency

The core guarantee: **a user can never over-draft cash or over-sell holdings, even
under concurrent orders.**

- **Single transaction per write.** `order.service`, `reset.service` and
  `auth.service.register` wrap their whole operation in `withTransaction`, so
  partial state is never visible or persisted.
- **Wallet row lock as the serialization point.** Inside a trade the wallet row is
  selected `FOR UPDATE` (`walletRepository.findByUserIdForUpdate`). Concurrent
  orders for the same user therefore queue on that lock and apply one at a time;
  the balance/holdings checks and mutations all happen while the lock is held.
- **Exact decimal math.** All monetary values use `decimal.js` at 4 dp, matching
  the `DECIMAL(15,4)` columns — no floating-point drift. See the `money()` helper
  repeated in the services.
- **Database-enforced invariants.** `CHECK (balance >= 0)`,
  `CHECK (quantity > 0/ >= 0)`, the `order_type ⇄ target_price` constraint, and the
  enum checks mean the DB rejects illegal states regardless of application bugs.

**Append-only ledger.** The `transactions` table is the audit trail. A
`BEFORE UPDATE OR DELETE` trigger (`reject_transaction_mutation`, created in
`scripts/init-db.js`) raises an exception on any mutation, so history can only ever
be appended — the guarantee holds even against direct SQL.

**Order lifecycle**
- **MARKET** → settles immediately: lock wallet → check funds/holdings → update
  wallet + position → write order (`FILLED`) + ledger row. Shortfall → `422`.
- **LIMIT** → stored `PENDING` (no reservation). The market-data matcher fills it
  when price crosses the target (BUY at ≤ target, SELL at ≥ target), or marks it
  `REJECTED` on a shortfall at fill time; `DELETE` cancels a still-`PENDING` order.

---

## 3. Market-data pipeline (`src/marketdata`)

Runs alongside the HTTP server, started from `src/server.js` via
`createMarketRuntime`.

```
tickSource ──ticks──▶ ingestionWorker ──┬─▶ market_prices  (upsert latest)
(finnhub | simulated)                   ├─▶ price_history  (append, throttled)
                                        ├─▶ order.service.processLimitOrdersForSymbol (fill crossed LIMITs)
                                        └─▶ marketSocket   (broadcast to browsers via ws /ws/market)
```

- **Tick source selection** (`marketHours` + key): the Finnhub trades WebSocket
  when the US market is open and `FINNHUB_API_KEY` is set; otherwise a simulated
  random walk (~1 tick / 2s). Both implement the `tickSource` interface.
- **`market_prices`** keeps only the latest price per asset (valuation + limit
  triggering); **`price_history`** keeps every tick and is the source for on-read
  candle aggregation in `/api/market/candles`.
- **Graceful shutdown**: `SIGINT`/`SIGTERM` stop the runtime, close the socket and
  server, and drain the pool.

---

## 4. Authentication flow

Token-based, built on Node `crypto` only (no `jsonwebtoken`/`bcrypt`).

- **Register** (`auth.service.register`): validate → hash password with scrypt
  (`utils/password`, stored as `scrypt$<salt>$<key>`) → create user + wallet in one
  transaction → return the hash-free user + a signed JWT.
- **Login**: look up by email, run one constant-work scrypt verification (dummy
  hash on a miss, so timing does not reveal whether the email exists) → issue a JWT.
- **Tokens** (`utils/token`): HS256 over `JWT_SECRET`, 7-day expiry. In production
  a missing `JWT_SECRET` fails closed; in dev a warned fallback is used.
- **`requireAuth`** middleware verifies the `Authorization: Bearer <token>` header
  and pins `req.userId`. **The acting user is always the token subject — never the
  request body or URL.** Every `/api/me/*` route sits behind it.

**Legacy surface.** The pre-auth `/api/users` and `/api/orders` routes (which trust
a client-supplied `userId`) are mounted only when `NODE_ENV !== production`, so
production exposes `/api/me/*` as the sole user-scoped API. See
[`api.md`](./api.md#legacy--dev-endpoints-unauthenticated-non-production-only).

---

## 5. Testing

`backend/tests` boots the real app in-process against a real PostgreSQL schema
(`npm run db:reset` first) and drives it over HTTP — covering the layers end to
end, plus concurrency invariants (overdraft/oversell caps, no lost updates) and
ledger↔wallet↔positions reconciliation. A `--require ./tests/env.js` preload sets
`NODE_ENV=test` so rate limiting and request logging stay inert during the run.
