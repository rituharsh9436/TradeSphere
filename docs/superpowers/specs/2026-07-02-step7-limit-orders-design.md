# Step 7 — Limit Orders Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Depends on:** Step 6a (price ingestion pipeline — merged), existing MARKET order engine.
**Scope:** Backend only. No frontend limit-order UI in this step.

## Goal

Add LIMIT orders to the paper-trading engine: a user places a LIMIT order that rests
as `PENDING`, a matcher fills it when the market price crosses its target, and the
user can cancel a still-pending order. MARKET order behavior is unchanged.

## Context

- Backend: Node.js CommonJS, Express 5, PostgreSQL via `pg`, `decimal.js`, Node's
  built-in test runner.
- The `orders` table already supports limit orders (no migration needed):
  `order_type IN ('MARKET','LIMIT')`, `side IN ('BUY','SELL')`,
  `quantity DECIMAL(15,4) > 0`, `target_price DECIMAL(15,4)`,
  `status IN ('PENDING','FILLED','CANCELLED','REJECTED') DEFAULT 'PENDING'`, plus a
  CHECK that LIMIT has a target_price and MARKET does not.
- `orderService.placeMarketOrder` runs the full fill in one transaction: resolve
  user/asset/price → lock wallet `FOR UPDATE` (serialization point) → check
  funds/holdings → update position (quantity-weighted avg buy price on BUY; qty
  down, avg unchanged on SELL) → update wallet → create order `FILLED` → write the
  immutable `transactions` ledger row.
- `order.repository` has `create`, `updateStatus(id, status)`, `listByUser`.
- The ingestion pipeline (`marketdata/ingestionWorker.js`, wired in
  `marketdata/runtime.js`) processes each tick `{symbol, price, ts}`: broadcasts to
  WS, and on a per-symbol throttle (default 1/sec) upserts `market_prices` +
  appends `price_history`.
- Money/prices are strings at 4 dp (USD) via `decimal.js`. Errors use
  `AppError(message, statusCode)`; controllers wrapped in `catchAsync`.

## Decisions (from brainstorming)

1. **No reservation.** Placing a LIMIT reserves nothing. Funds/holdings are checked
   at fill time; insufficient → order `REJECTED`.
2. **Fill at target price.** A crossed order executes at its `target_price`
   (deterministic), recorded in the ledger.
3. **Tick-driven matcher, per symbol.** Hooked into the ingestion pipeline's
   throttled price-update path; only the symbol that moved is scanned.
4. **Full-fill only.** No partial fills / no order book (YAGNI). A triggered order
   fills its whole quantity or is REJECTED.

## Trigger semantics

For a PENDING LIMIT order on an asset whose latest price is `p`:
- **BUY** fills when `p <= target_price` (buy at or below the limit).
- **SELL** fills when `p >= target_price` (sell at or above the limit).
- Execution price is always `target_price`.
- A "marketable" limit (e.g. BUY with `target_price >= current price`) is not
  special-cased at placement; it rests as PENDING and fills on the next throttled
  tick (~1s later).

## Architecture

```
POST /api/orders {userId,symbol,side,quantity,orderType?,targetPrice?}
   orderType MARKET (default) → orderService.placeMarketOrder   (unchanged)
   orderType LIMIT            → orderService.placeLimitOrder     (insert PENDING)

tick {symbol,price} ─(throttled path in ingestionWorker)─▶ onPriceUpdate({symbol,price})
   runtime wires onPriceUpdate → orderService.processLimitOrdersForSymbol({symbol,price})
       load PENDING LIMIT orders for asset(symbol)
       for each crossed order → fill in its own transaction (see below)

DELETE /api/orders/:id?userId=… → orderService.cancelOrder({orderId,userId})
   PENDING → CANCELLED (ownership-checked)
```

### Shared fill core (DRY refactor)

Extract the wallet-lock + funds/holdings-check + position-update + wallet-update
logic currently inside `placeMarketOrder` into an internal helper:

`settleFill(client, { userId, asset, side, qty, price }) → { ok: boolean, reason?, wallet?, newBalance? }`

- Locks the wallet row `FOR UPDATE`, locks the position `FOR UPDATE`.
- BUY: if `balance < price*qty` → `{ ok: false, reason: 'INSUFFICIENT_FUNDS' }`; else
  debit wallet, upsert position with quantity-weighted avg buy price.
- SELL: if holdings `< qty` → `{ ok: false, reason: 'INSUFFICIENT_HOLDINGS' }`; else
  credit wallet, reduce position quantity (avg unchanged).
- On success returns `{ ok: true, wallet, newBalance }`. It does NOT create the order
  or ledger row — callers own the order lifecycle.
- Money math stays at 4 dp via the existing `money()` helper.

`placeMarketOrder` becomes: resolve user/asset/current price → `settleFill(...)` → if
`!ok` throw `AppError(422, ...)` (unchanged external behavior) → create order FILLED
+ ledger. `settleFill` uses the current market price.

## Components & interfaces

### `services/order.service.js` (modify)
- `settleFill(client, { userId, asset, side, qty, price })` — internal, above.
- `placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) → Promise<order>`
  — validates (side BUY/SELL; quantity>0; targetPrice provided and >0), resolves
  user (404) + active asset (404); inserts an order `order_type='LIMIT'`,
  `status='PENDING'`, `target_price`. No wallet/position writes. Returns the order.
- `processLimitOrdersForSymbol({ symbol, price }) → Promise<{ filled, rejected }>`
  — resolves the asset by symbol (returns early if unknown/inactive); loads PENDING
  LIMIT orders for the asset; for each order whose trigger is crossed at `price`,
  runs `fillLimitOrder` in its own transaction. Aggregates counts. Never throws to
  the caller (pipeline hook must not crash the stream); per-order errors are logged.
- `fillLimitOrder(orderId) → Promise<'FILLED'|'REJECTED'|'SKIPPED'>` — internal, in a
  transaction: `SELECT … FOR UPDATE` the order (`findByIdForUpdate`); if not still
  `PENDING` → `SKIPPED` (idempotency guard against a concurrent run); re-resolve the
  asset's current price and re-check the trigger is still crossed (→ `SKIPPED` if
  not); call `settleFill` at `target_price`; on `ok` set status `FILLED` + write
  ledger row (transaction type = side, amount = target*qty, price = target) →
  `FILLED`; on `!ok` set status `REJECTED` → `REJECTED`.
- `cancelOrder({ orderId, userId }) → Promise<order>` — in a transaction:
  `findByIdForUpdate`; if missing or `user_id !== userId` → `AppError(404)`; if status
  `!== 'PENDING'` → `AppError(409, 'Only pending orders can be cancelled.')`; set
  status `CANCELLED`; return the order.

### `repositories/order.repository.js` (modify)
- `findPendingLimitByAsset(assetId, client = pool) → Promise<Array<{id, user_id, side, quantity, target_price}>>`
  — `WHERE asset_id=$1 AND order_type='LIMIT' AND status='PENDING'`.
- `findByIdForUpdate(id, client = pool) → Promise<order|null>` — `SELECT … FOR UPDATE`
  (full row incl. `user_id, asset_id, side, quantity, target_price, status`).
- Reuse existing `updateStatus`, `create`.

### `controllers/order.controller.js` (modify)
- `place` (rename of/replacing `placeMarket` semantics): reads
  `{ userId, symbol, side, quantity, orderType, targetPrice }`; if
  `orderType==='LIMIT'` → `placeLimitOrder` (201); else → `placeMarketOrder` (201).
- `cancel`: reads `req.params.id` + `req.query.userId`; calls `cancelOrder`; 200 with
  the updated order.

### `routes/order.routes.js` (modify)
- `POST /` → `orderController.place` (handles MARKET + LIMIT).
- `DELETE /:id` → `orderController.cancel`.
- `GET /user/:userId` unchanged.

### `marketdata/ingestionWorker.js` (modify)
- Accept an optional `onPriceUpdate` callback in the factory options. In the
  throttled path (where `persist` runs), also invoke
  `onPriceUpdate({ symbol, price })` guarded by a per-symbol in-flight flag so
  overlapping matcher runs for the same symbol don't pile up; errors from the hook
  are caught and logged (never break ingestion). Absent callback → no-op (keeps unit
  tests and MARKET-only setups unaffected).

### `marketdata/runtime.js` (modify)
- Inject `onPriceUpdate: ({symbol, price}) => orderService.processLimitOrdersForSymbol({symbol, price})`
  (via `deps` default, overridable for tests) into `createIngestionWorker`.

## Error handling

- Placement validation: missing/invalid side, quantity ≤ 0, missing/≤0 targetPrice →
  `AppError(400)`. Unknown/inactive asset or user → `AppError(404)`. DB CHECK on
  `target_price` is a backstop (mapped to 400 by the central handler) but the service
  validates first so the friendly message wins.
- Fill path: insufficient funds/holdings → order `REJECTED` (committed), not an error
  to the pipeline. Unexpected per-order errors in `processLimitOrdersForSymbol` are
  caught and logged; other pending orders still process.
- Cancel: not found / not owner → 404; not pending → 409.
- The matcher hook is wrapped so a matcher failure never kills the tick stream.

## Concurrency & idempotency

- Every fill and cancel locks the order row `FOR UPDATE` and re-checks `status` before
  mutating, so a price tick racing with a cancel (or two matcher runs racing) can
  never double-fill or fill-a-cancelled order — the loser sees a non-PENDING status
  and skips.
- The wallet row `FOR UPDATE` remains the per-user serialization point (shared with
  MARKET orders), so a limit fill and a concurrent market order can't over-draft.
- The per-symbol in-flight flag in the worker bounds matcher concurrency; correctness
  does not depend on it (the row locks do), it only avoids redundant work.

## Testing

`tests/limitOrders.test.js` (DB; boots app in-process; isolates by unique
users/symbols; restores seed prices it mutates):
- `placeLimitOrder` inserts PENDING with no wallet/position change.
- BUY LIMIT fills at target when `processLimitOrdersForSymbol` sees `price <= target`:
  wallet debited by `target*qty`, position updated, order FILLED, ledger row at target.
- SELL LIMIT fills when `price >= target`; wallet credited, holdings reduced.
- Not-crossed price leaves the order PENDING.
- Insufficient funds at fill → order REJECTED, wallet unchanged.
- Idempotency: calling `processLimitOrdersForSymbol` twice for a crossed order fills
  it exactly once (second run SKIPs).
- `cancelOrder`: PENDING → CANCELLED; already FILLED/CANCELLED → 409; wrong user → 404.
- Validation: LIMIT without targetPrice → 400; targetPrice ≤ 0 → 400; bad side → 400.
- HTTP: `POST /api/orders` with `orderType:'LIMIT'` → 201 PENDING;
  `DELETE /api/orders/:id?userId=` → 200 CANCELLED; MARKET path still 201 FILLED
  (regression).

Unit-level (no DB) for the worker hook: `ingestionWorker` invokes `onPriceUpdate` on
the throttled path and does not pile up overlapping runs per symbol (fake source +
injected hook), mirroring the existing worker unit test.

## Out of scope (YAGNI)

- Reserved funds / buying-power accounting (decided against).
- Partial fills, order book, price-time priority.
- Frontend limit-order UI and any WS "order filled" push.
- Stop / stop-limit / time-in-force (GTC/GTD) / order expiry.
- Editing a resting order (cancel + re-place instead).

## File summary

**Modify:** `backend/src/services/order.service.js`,
`backend/src/repositories/order.repository.js`,
`backend/src/controllers/order.controller.js`,
`backend/src/routes/order.routes.js`,
`backend/src/marketdata/ingestionWorker.js`,
`backend/src/marketdata/runtime.js`.

**Create (tests):** `backend/tests/limitOrders.test.js`; extend
`backend/tests/marketdata.unit.test.js` for the worker hook.

**Docs:** `TODO.md` (mark Step 7 done), `MEMORY.md` (limit-order flow + `DELETE`
route + matcher note).
