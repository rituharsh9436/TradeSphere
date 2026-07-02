# Step 8 — Leaderboard & Ranking Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Depends on:** existing portfolio valuation (Step 5), market prices (Step 6a).
**Scope:** Backend only. No frontend leaderboard wiring.

## Goal

Add `GET /api/leaderboard` — a ranked list of users by total equity (cash + holdings
at current market price), with ROI shown alongside.

## Context

- Backend: Node.js CommonJS, Express 5, PostgreSQL via `pg`, `decimal.js`, Node's
  built-in test runner.
- Portfolio valuation (`portfolio.service.js`) already defines the model this reuses:
  `totalEquity = cashBalance + Σ(quantity × current_price)` over priced holdings;
  `roiPct = (totalEquity − 100000) / 100000 × 100`; unpriced holdings (no
  `market_prices` row) are excluded from the total but surfaced via `unpricedSymbols`.
  `STARTING_CAPITAL = 100000` is the wallet default (no deposits exist).
- Every user gets exactly one wallet at registration (starting cash $100,000) and at
  most one `market_prices` row per asset (`upsertLatest` uses `ON CONFLICT (asset_id)`),
  so the aggregation join never multiplies rows.
- Money/percentages are strings at 4 dp via `decimal.js` (`money()`/`pct()` helpers).
  Errors use `AppError(message, statusCode)`; controllers wrapped in `catchAsync`.
- Layering `routes → controllers → services → repositories → DB`. Existing indexes
  include `idx_positions_user_id`; `market_prices.asset_id` is unique (PK/conflict key).
- Route aggregator `routes/index.js` mounts `/users`, `/orders`, `/market`.

## Key equivalence

Because every user starts at exactly $100,000 and there is no deposit/withdrawal,
`equity = 100000 × (1 + roi/100)` is a strictly increasing function of ROI. Ranking
by **total equity** therefore produces the **identical order** as ranking by ROI. The
leaderboard ranks by equity in SQL and derives ROI for display; the two never
disagree.

## Decisions (from brainstorming)

1. **Scope:** top-N with `?limit` (default 50, capped at 200). No offset pagination.
2. **Entry fields:** `rank` (1-based), `userId`, `username`, `totalEquity`, `roiPct`,
   `hasUnpricedHoldings`.
3. **Unpriced holdings:** excluded from `totalEquity` (matching the portfolio total);
   a per-user `hasUnpricedHoldings` boolean flags a possibly-understated equity.

## Architecture

A new vertical slice mirroring the existing layering:

```
GET /api/leaderboard?limit=N
  routes/leaderboard.routes.js → controllers/leaderboard.controller.js
    → services/leaderboard.service.js.getLeaderboard({ limit })
      → repositories/leaderboard.repository.js.findRankedByEquity(limit)
        → one aggregation query over users ⋈ wallets ⋈ positions ⋈ market_prices
```

### Aggregation query (`findRankedByEquity`)

```sql
SELECT u.id, u.username, u.created_at, w.balance,
       COALESCE(SUM(p.quantity * m.price), 0) AS holdings_value,
       BOOL_OR(p.asset_id IS NOT NULL AND m.price IS NULL) AS has_unpriced
FROM users u
JOIN wallets w ON w.user_id = u.id
LEFT JOIN positions p ON p.user_id = u.id AND p.quantity > 0
LEFT JOIN market_prices m ON m.asset_id = p.asset_id
GROUP BY u.id, u.username, u.created_at, w.balance
ORDER BY (w.balance + COALESCE(SUM(p.quantity * m.price), 0)) DESC,
         u.created_at ASC, u.id ASC
LIMIT $1
```

- `JOIN wallets` includes every user (cash-only users appear with equity = balance).
- `LEFT JOIN positions … AND p.quantity > 0` keeps users with no holdings.
- Unpriced position (`m.price IS NULL`): `p.quantity * m.price` is NULL, so `SUM`
  skips it — excluded from `holdings_value`, exactly like the portfolio total.
  `has_unpriced` is true when the user holds at least one such asset.
- Deterministic ordering: equity DESC, then `created_at ASC`, then `id ASC` — stable
  for tests and for ties.
- Returns raw `balance` and `holdings_value` (numeric); ROI/equity display formatting
  happens in the service.

Efficiency: the per-user grouping uses `idx_positions_user_id`; the price lookup uses
the `market_prices.asset_id` unique index. No new index is required at this scale (the
query is an all-users aggregation bounded by `LIMIT` on output).

### Service (`getLeaderboard`)

- Validate `limit`: `Number(limit ?? 50)`; must be an integer in `[1, 200]` → else
  `AppError('limit must be an integer between 1 and 200.', 400)`.
- Call `findRankedByEquity(limit)`. Map each row (already ordered) to:
  ```js
  {
    rank: index + 1,
    userId: row.id,
    username: row.username,
    totalEquity: money(new Decimal(row.balance).plus(row.holdings_value)),
    roiPct: pct(equity.minus(100000).div(100000).times(100)),
    hasUnpricedHoldings: row.has_unpriced,
  }
  ```
  using `decimal.js` at 4 dp. `STARTING_CAPITAL = 100000` defined locally (wallet
  default).
- Returns the array (the controller adds `results`/`status`).

### Controller + route

- `leaderboardController.getLeaderboard` (catchAsync): reads `req.query.limit`, calls
  the service, responds `{ status: 'success', results: entries.length, data: entries }`.
- `leaderboard.routes.js`: `GET /` → controller.
- `routes/index.js`: `router.use('/leaderboard', leaderboardRoutes)`.

## Error handling

- Invalid `limit` (non-integer, < 1, > 200) → `AppError(400)`.
- Otherwise a pure read — no 404s. An empty user base yields `data: []`.

## Testing

`tests/leaderboard.test.js` (DB + HTTP; boots app in-process). The leaderboard is
**global**, so tests assert **relative** ordering among their own uniquely-created
users (found by `userId` in the response), never absolute ranks or full-list equality:

- Cash-only user: appears with `totalEquity` ≈ `100000.0000`, `roiPct` `0.0000`.
- A user who buys and whose asset rises (raise its `market_prices` price for the test,
  restore after) ranks **above** a cash-only user; ROI > 0.
- A user who buys and whose asset falls ranks **below** a cash-only user; ROI < 0.
- `?limit=1` returns exactly one entry; `rank` is 1-based and increases down the list.
- `hasUnpricedHoldings`: a user holding an asset whose `market_prices` row is removed
  for the test (restored after) has the flag `true`, and their equity excludes it.
- Validation: `?limit=0`, `?limit=abc`, `?limit=999` → 400.
- Response shape: `status:'success'`, `results` = entries length, entries carry the
  six fields.

Tests restore any shared `market_prices` rows they mutate (seed AAPL=195, MSFT=430,
TSLA=250) so the suite stays order-independent.

## Out of scope (YAGNI)

- Frontend leaderboard page wiring (the `Leaderboard.jsx` stub stays as-is).
- Per-user rank lookup / "your rank" endpoint.
- Realized-P/L, time-windowed (daily/weekly) ranking, or historical snapshots.
- Caching / materialized leaderboard table.
- Offset pagination.

## File summary

**Create:** `backend/src/repositories/leaderboard.repository.js`,
`backend/src/services/leaderboard.service.js`,
`backend/src/controllers/leaderboard.controller.js`,
`backend/src/routes/leaderboard.routes.js`,
`backend/tests/leaderboard.test.js`.

**Modify:** `backend/src/routes/index.js` (mount `/leaderboard`), `TODO.md`,
`MEMORY.md` (route rows + leaderboard note).
