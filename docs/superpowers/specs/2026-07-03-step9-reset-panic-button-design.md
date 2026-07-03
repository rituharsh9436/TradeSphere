# Step 9 — Reset / restart (panic button) — Design

**Date:** 2026-07-03
**Status:** Approved (design gate passed)

## Goal

Give a user a one-call "panic button" that returns their account to the starting
state: `POST /api/users/:id/reset` liquidates all open positions, cancels all
pending orders, and restores the wallet to the fixed starting balance
(`$100,000`) — while **preserving the audit trail** by appending `RESET` rows to
the append-only transactions ledger (never deleting history).

## Endpoint

`POST /api/users/:id/reset` → `200`

```json
{
  "status": "success",
  "data": {
    "wallet": { "id": "...", "user_id": "...", "balance": "100000.0000", "updated_at": "..." },
    "positionsLiquidated": 2,
    "ordersCancelled": 1,
    "resetTransactions": [ { "id": "...", "transaction_type": "RESET", "amount": "...", "price_per_share": "..." } ]
  }
}
```

- `404` if the user does not exist.

## Behavior — one `withTransaction`, wallet locked FOR UPDATE

The wallet row is the per-user serialization point (same as order execution), so
locking it first means a reset can never interleave with a concurrent market/limit
fill for the same user.

1. **Resolve user** — `userRepository.findById(userId, client)` → `AppError(404)` if missing.
2. **Lock wallet** — `walletRepository.findByUserIdForUpdate(userId, client)` → `AppError(404)` if missing.
3. **Cancel pending orders** — `orderRepository.cancelAllPendingByUser(userId, client)`:
   a single `UPDATE orders SET status='CANCELLED' ... WHERE user_id=$1 AND status='PENDING' RETURNING id`.
   `ordersCancelled = rows.length`.
4. **Liquidate positions** — `positionRepository.findByUser(userId, client)` (returns qty > 0). For each position:
   - Resolve price: `assetRepository.getPrice(assetId, client)`; **if `null`, fall back to `average_buy_price`** (feed-quiet safety — the panic button must never get stuck).
   - Append a `RESET` ledger row via `transactionRepository.create`:
     `{ userId, orderId: null, transactionType: 'RESET', amount: money(qty × price), pricePerShare: money(price) }`.
   - Zero the holding: `positionRepository.update({ userId, assetId, quantity: '0.0000', averageBuyPrice: <unchanged> }, client)`
     (the `qty > 0` filter then hides it from portfolio/leaderboard).
   - `positionsLiquidated += 1`.
5. **Restore wallet** — `walletRepository.updateBalance(userId, '100000.0000', client)`.
6. **Return** `{ wallet, positionsLiquidated, ordersCancelled, resetTransactions }`.

## Decisions (locked with the user)

- **Liquidation audit granularity:** one `RESET` ledger row **per open position**, valued at
  the current market price (`amount = qty × price`, `price_per_share = price`). Faithful record
  of what was held and at what value it was wiped.
- **Missing market price:** fall back to the position's stored `average_buy_price` so the RESET
  row is always well-formed and the reset always succeeds.
- **Idempotent / no-op safe:** callable on an already-clean account (0 positions, 0 orders,
  balance already 100k). The loops simply don't iterate, no `RESET` rows are written, and
  `updateBalance` harmlessly re-sets 100k. Returns zero counts.

## Ledger reconciliation note (explicit, reviewed)

Because this is a **hard reset**, the wallet is forced to exactly `$100,000` regardless of the
liquidation proceeds. The per-position `RESET` rows document *what was liquidated at reset time*
(their amounts do **not** sum into the final balance — the balance is definitional, not
`oldBalance + Σ liquidations`). This is intentional and matches the "restore to starting balance"
requirement; it is not a bookkeeping bug. The ledger remains append-only — `RESET` rows are only
ever INSERTed, never UPDATEd/DELETEd (the DB trigger still enforces this).

## Constraints / invariants (tested)

- After reset: `findByUser` returns `[]` (all positions qty 0); no `PENDING` orders remain for the
  user; wallet balance is exactly `100000.0000`.
- Every pre-reset `BUY`/`SELL` ledger row still exists (audit trail preserved); new rows are all
  `transaction_type='RESET'` with `order_id IS NULL`.
- Reset of a user holding an asset whose `market_prices` row is missing succeeds and values that
  position at its `average_buy_price`.
- No-op reset (clean account) returns `positionsLiquidated: 0, ordersCancelled: 0` and writes no
  `RESET` row.
- Unknown `:id` → `404`.
- Concurrency: reset serializes against order fills on the wallet lock (same mechanism as Step 7).

## Code touch points

**Create:**
- `backend/src/services/reset.service.js` — `resetAccount({ userId })`.
- `backend/tests/reset.test.js` — invariants above.

**Modify:**
- `backend/src/repositories/order.repository.js` — add `cancelAllPendingByUser(userId, client = pool)`.
- `backend/src/controllers/user.controller.js` — add `reset` (catchAsync).
- `backend/src/routes/user.routes.js` — `router.post('/:id/reset', userController.reset)`.
- `TODO.md`, `MEMORY.md`.

## Non-goals

- No auth check on who may reset whom (Step 10 introduces auth; today the app trusts the caller,
  consistent with every other endpoint).
- No "soft reset" / partial reset options — one button, full restore.
- No frontend button this step (backend + tests only), consistent with prior backend steps.
