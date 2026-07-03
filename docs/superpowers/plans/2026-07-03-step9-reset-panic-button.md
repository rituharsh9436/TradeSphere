# Step 9 — Reset / restart (panic button) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/users/:id/reset` — a panic button that liquidates all open positions, cancels all pending orders, and restores the wallet to the fixed starting balance (`$100,000`), appending `RESET` rows to the append-only ledger to preserve the audit trail.

**Architecture:** A new `reset.service.js` orchestrates the whole reset inside one `withTransaction` with the wallet locked FOR UPDATE (the per-user serialization point). One new repo method (`orderRepository.cancelAllPendingByUser`) cancels pending orders in bulk; positions are liquidated to per-position `RESET` ledger rows (valued at market, falling back to `average_buy_price`) then zeroed; the wallet is set to `100000`. A thin controller + route expose it under the existing `/users` router.

**Tech Stack:** Node.js (CommonJS), Express 5, PostgreSQL via `pg`, `decimal.js`, Node built-in test runner.

## Global Constraints

- Language CommonJS. Money values are strings at **4 dp** via `decimal.js` (`money(v) = new Decimal(v).toFixed(4)`).
- `STARTING_CAPITAL = '100000'` (wallet default; no deposits). Reset forces balance to exactly `100000.0000`.
- Whole reset is atomic: one `withTransaction`, wallet locked via `walletRepository.findByUserIdForUpdate` FIRST.
- `RESET` ledger rows: `transaction_type='RESET'`, `order_id = null`, `amount = qty × price`, `price_per_share = price`. Price = current market price, else the position's `average_buy_price`.
- Ledger is append-only (DB trigger rejects UPDATE/DELETE); reset only ever INSERTs `RESET` rows — pre-existing history is preserved.
- Idempotent / no-op safe: clean account → zero counts, no `RESET` rows written, `updateBalance` re-sets 100k harmlessly.
- Layering `routes → controllers → services → repositories → DB`; repo methods take a trailing `client = pool`; controllers wrapped in `catchAsync`; errors via `AppError(message, statusCode)`.
- Tests: `npm test` from `backend/` (`node --test --test-concurrency=1 "tests/**/*.test.js"`); DB via `npm run db:reset` (seeds AAPL=195, MSFT=430, TSLA=250, each active + priced). Tests create their own unique users and assert on them by id; restore any shared `market_prices` they mutate.
- Run all commands from `backend/`.

---

## File Structure

**Create:**
- `src/services/reset.service.js` — `resetAccount({ userId })`.
- `tests/reset.test.js` — repo method + service + HTTP invariants.

**Modify:**
- `src/repositories/order.repository.js` — add `cancelAllPendingByUser`.
- `src/controllers/user.controller.js` — add `reset`.
- `src/routes/user.routes.js` — mount `POST /:id/reset`.
- `TODO.md`, `MEMORY.md`.

---

### Task 1: `orderRepository.cancelAllPendingByUser` — bulk cancel

**Files:**
- Modify: `backend/src/repositories/order.repository.js`
- Test: `backend/tests/reset.test.js` (new)

**Interfaces:**
- Produces: `cancelAllPendingByUser(userId, client = pool) → Promise<Array<{ id }>>` — flips every `PENDING` order for the user to `CANCELLED`, returns the cancelled ids. Non-pending orders (FILLED/CANCELLED/REJECTED) are untouched.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/reset.test.js`:

```js
'use strict';

// Step 9 — reset / panic button. Boots the app in-process and exercises the
// bulk-cancel repo method, the reset service, and the endpoint. Each test creates
// its own unique users and asserts on them by id; shared seed prices (AAPL=195,
// MSFT=430, TSLA=250) are restored if mutated. Schema via `npm run db:reset`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');
const orderRepository = require('../src/repositories/order.repository');
const marketPriceRepository = require('../src/repositories/marketPrice.repository');

let server;
let base;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});

const tag = () => `${process.pid}_${process.hrtime.bigint().toString(36)}`;

async function apiJson(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

async function registerUser() {
  const t = tag();
  const r = await apiJson('POST', '/api/users', { username: `rst_${t}`, email: `rst_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function marketBuy(userId, symbol, quantity) {
  const r = await apiJson('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });
  assert.equal(r.status, 201, `buy: ${JSON.stringify(r.body)}`);
}

async function placeLimit(userId, symbol, side, quantity, targetPrice) {
  const r = await apiJson('POST', '/api/orders', {
    userId, symbol, side, quantity, orderType: 'LIMIT', targetPrice,
  });
  assert.equal(r.status, 201, `limit: ${JSON.stringify(r.body)}`);
  return r.body.data.order.id; // LIMIT response nests the order under data.order
}

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}
async function setPrice(symbol, price) {
  await marketPriceRepository.upsertLatest(await assetIdOf(symbol), price);
}
async function deletePrice(symbol) {
  await pool.query('DELETE FROM market_prices WHERE asset_id = $1', [await assetIdOf(symbol)]);
}

test('orderRepository.cancelAllPendingByUser: cancels only this user\'s PENDING orders', async () => {
  const user = await registerUser();
  const other = await registerUser();
  // Two far-from-market PENDING limits for `user` (BUY below market never crosses).
  await placeLimit(user, 'AAPL', 'BUY', 1, '1.0000');
  await placeLimit(user, 'MSFT', 'BUY', 1, '1.0000');
  // One PENDING limit for `other` — must be untouched.
  const otherOrder = await placeLimit(other, 'AAPL', 'BUY', 1, '1.0000');

  const cancelled = await orderRepository.cancelAllPendingByUser(user);
  assert.equal(cancelled.length, 2, 'both of user\'s pending orders cancelled');

  const mine = await orderRepository.listByUser(user);
  assert.ok(mine.every((o) => o.status === 'CANCELLED'), 'no pending left for user');
  const theirs = await orderRepository.listByUser(other);
  assert.equal(theirs.find((o) => o.id === otherOrder).status, 'PENDING', 'other user untouched');

  // Idempotent: second call cancels nothing.
  const again = await orderRepository.cancelAllPendingByUser(user);
  assert.equal(again.length, 0, 'no-op on already-clean');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:reset && npm test`
Expected: FAIL — `orderRepository.cancelAllPendingByUser is not a function`.

- [ ] **Step 3: Implement the repo method**

In `backend/src/repositories/order.repository.js`, add this method (after `findPendingLimitByAsset`, keeping the trailing `client = pool` convention):

```js
  // Bulk-cancels every PENDING order for a user (used by the reset/panic button).
  // Returns the cancelled ids; non-pending orders are left as-is.
  async cancelAllPendingByUser(userId, client = pool) {
    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND status = 'PENDING'
       RETURNING id`,
      [userId]
    );
    return rows;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — user's two pending orders cancelled, other user's untouched, second call is a no-op.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/order.repository.js backend/tests/reset.test.js
git commit -m "feat(step9): orderRepository.cancelAllPendingByUser bulk cancel"
```

---

### Task 2: `reset.service.resetAccount` — orchestrate the full reset

**Files:**
- Create: `backend/src/services/reset.service.js`
- Test: `backend/tests/reset.test.js`

**Interfaces:**
- Consumes: `userRepository.findById`, `walletRepository.findByUserIdForUpdate` + `updateBalance`, `orderRepository.cancelAllPendingByUser`, `positionRepository.findByUser` + `update`, `assetRepository.getPrice`, `transactionRepository.create`, `withTransaction`.
- Produces: `resetAccount({ userId }) → Promise<{ wallet, positionsLiquidated, ordersCancelled, resetTransactions }>`. Unknown user → `AppError(404)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/reset.test.js`:

```js
const resetService = require('../src/services/reset.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const positionRepository = require('../src/repositories/position.repository');
const walletRepository = require('../src/repositories/wallet.repository');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('resetService.resetAccount: unknown user -> 404', async () => {
  await rejectsWith(
    () => resetService.resetAccount({ userId: '00000000-0000-0000-0000-000000000000' }),
    404
  );
});

test('resetService.resetAccount: liquidates positions, cancels orders, restores wallet, preserves ledger', async () => {
  const user = await registerUser();
  await marketBuy(user, 'AAPL', 10); // @195 -> cash 98050, position 10 @195
  await marketBuy(user, 'MSFT', 2);  // @430 -> cash 97190, position 2 @430
  await placeLimit(user, 'TSLA', 'BUY', 1, '1.0000'); // resting PENDING

  const ledgerBefore = await transactionRepository.listByUser(user);
  const buysBefore = ledgerBefore.filter((t) => t.transaction_type === 'BUY').length;
  assert.equal(buysBefore, 2, 'two BUY rows recorded pre-reset');

  const result = await resetService.resetAccount({ userId: user });

  assert.equal(result.positionsLiquidated, 2);
  assert.equal(result.ordersCancelled, 1);
  assert.equal(result.wallet.balance, '100000.0000', 'wallet restored to starting balance');

  // Positions all zeroed (findByUser filters qty > 0).
  const positions = await positionRepository.findByUser(user);
  assert.equal(positions.length, 0, 'no open positions remain');

  // No pending orders remain.
  const orders = await orderRepository.listByUser(user);
  assert.ok(orders.every((o) => o.status !== 'PENDING'), 'no pending orders remain');

  // Audit trail preserved + RESET rows appended (one per liquidated position).
  const ledgerAfter = await transactionRepository.listByUser(user);
  assert.equal(
    ledgerAfter.filter((t) => t.transaction_type === 'BUY').length,
    buysBefore,
    'original BUY rows still present'
  );
  const resets = ledgerAfter.filter((t) => t.transaction_type === 'RESET');
  assert.equal(resets.length, 2, 'one RESET row per liquidated position');
  assert.ok(resets.every((t) => t.order_id === null), 'RESET rows carry no order_id');
  // AAPL 10 @195 = 1950 ; MSFT 2 @430 = 860.
  const amounts = resets.map((t) => t.amount).sort();
  assert.deepEqual(amounts, ['1950.0000', '860.0000'].sort());
});

test('resetService.resetAccount: values unpriced holdings at average_buy_price', async () => {
  const user = await registerUser();
  await marketBuy(user, 'TSLA', 3); // @250 -> position 3 @250
  await deletePrice('TSLA');        // feed goes quiet: no market price

  const result = await resetService.resetAccount({ userId: user });
  await setPrice('TSLA', '250.0000'); // restore shared seed price

  assert.equal(result.positionsLiquidated, 1);
  const reset = result.resetTransactions[0];
  assert.equal(reset.price_per_share, '250.0000', 'fell back to average_buy_price');
  assert.equal(reset.amount, '750.0000', '3 x 250');
  assert.equal(result.wallet.balance, '100000.0000');
});

test('resetService.resetAccount: no-op on a clean account', async () => {
  const user = await registerUser(); // fresh: cash 100k, no positions/orders
  const result = await resetService.resetAccount({ userId: user });
  assert.equal(result.positionsLiquidated, 0);
  assert.equal(result.ordersCancelled, 0);
  assert.equal(result.resetTransactions.length, 0, 'no RESET rows written when nothing to liquidate');
  assert.equal(result.wallet.balance, '100000.0000');

  const ledger = await transactionRepository.listByUser(user);
  assert.equal(ledger.filter((t) => t.transaction_type === 'RESET').length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/services/reset.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/reset.service.js`:

```js
const Decimal = require('decimal.js');

const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const orderRepository = require('../repositories/order.repository');
const positionRepository = require('../repositories/position.repository');
const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');

// DECIMAL(15,4) in the schema — keep all monetary values at 4 dp.
const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);
// The wallet's fixed starting cash (no deposits exist); reset restores exactly this.
const STARTING_CAPITAL = '100000';

const resetService = {
  // Panic button: liquidate all positions, cancel all pending orders, and force
  // the wallet back to the starting balance — atomically, with the wallet locked
  // FOR UPDATE first so a reset never interleaves with a concurrent order fill.
  // The ledger is append-only: we INSERT one RESET row per liquidated position
  // (valued at market, or the position's average_buy_price when the feed is quiet)
  // and never touch prior history.
  async resetAccount({ userId }) {
    if (!userId) throw new AppError('userId is required.', 400);

    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      if (!wallet) throw new AppError('Wallet not found for this user.', 404);

      // 1) Cancel every PENDING order.
      const cancelled = await orderRepository.cancelAllPendingByUser(userId, client);

      // 2) Liquidate every open position into a RESET ledger row, then zero it.
      const positions = await positionRepository.findByUser(userId, client);
      const resetTransactions = [];
      for (const position of positions) {
        const marketPrice = await assetRepository.getPrice(position.asset_id, client);
        const price = new Decimal(marketPrice ?? position.average_buy_price);
        const qty = new Decimal(position.quantity);

        const tx = await transactionRepository.create(
          {
            userId,
            orderId: null,
            transactionType: 'RESET',
            amount: money(price.times(qty)),
            pricePerShare: money(price),
          },
          client
        );
        resetTransactions.push(tx);

        await positionRepository.update(
          {
            userId,
            assetId: position.asset_id,
            quantity: money(0),
            averageBuyPrice: money(position.average_buy_price),
          },
          client
        );
      }

      // 3) Restore the wallet to the fixed starting balance.
      const updatedWallet = await walletRepository.updateBalance(
        userId,
        money(STARTING_CAPITAL),
        client
      );

      return {
        wallet: updatedWallet,
        positionsLiquidated: positions.length,
        ordersCancelled: cancelled.length,
        resetTransactions,
      };
    });
  },
};

module.exports = resetService;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 404 for unknown user; full reset liquidates 2 positions / cancels 1 order / wallet 100k / BUY rows preserved / 2 RESET rows; unpriced holding valued at avg buy price; clean-account no-op writes no RESET rows.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/reset.service.js backend/tests/reset.test.js
git commit -m "feat(step9): reset.service.resetAccount (liquidate + cancel + restore)"
```

---

### Task 3: controller + route

**Files:**
- Modify: `backend/src/controllers/user.controller.js`, `backend/src/routes/user.routes.js`
- Test: `backend/tests/reset.test.js`

**Interfaces:**
- Consumes: `resetService.resetAccount`.
- Produces route `POST /api/users/:id/reset` → `200 { status:'success', data: { wallet, positionsLiquidated, ordersCancelled, resetTransactions } }`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/reset.test.js`:

```js
test('POST /api/users/:id/reset resets the account and returns a summary', async () => {
  const user = await registerUser();
  await marketBuy(user, 'AAPL', 4); // @195 -> position 4
  await placeLimit(user, 'MSFT', 'BUY', 1, '1.0000'); // PENDING

  const r = await apiJson('POST', `/api/users/${user}/reset`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'success');
  assert.equal(r.body.data.positionsLiquidated, 1);
  assert.equal(r.body.data.ordersCancelled, 1);
  assert.equal(r.body.data.wallet.balance, '100000.0000');

  // Confirm via the public endpoints too.
  const wallet = await apiJson('GET', `/api/users/${user}/wallet`);
  assert.equal(wallet.body.data.balance, '100000.0000');
  const positions = await apiJson('GET', `/api/users/${user}/positions`);
  assert.equal(positions.body.data.length, 0);
});

test('POST /api/users/:id/reset unknown user -> 404', async () => {
  const r = await apiJson('POST', '/api/users/00000000-0000-0000-0000-000000000000/reset');
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `POST /api/users/:id/reset` returns 404 (route not mounted; note the "unknown user -> 404" case would coincidentally pass, but the reset-summary test fails).

- [ ] **Step 3: Implement the controller**

In `backend/src/controllers/user.controller.js`, add the require at the top (after the existing service requires):

```js
const resetService = require('../services/reset.service');
```

and add this handler to the `userController` object (after `getPortfolio`):

```js
  // POST /api/users/:id/reset — panic button: liquidate positions, cancel
  // pending orders, restore the wallet to the starting balance.
  reset: catchAsync(async (req, res) => {
    const summary = await resetService.resetAccount({ userId: req.params.id });
    res.status(200).json({ status: 'success', data: summary });
  }),
```

- [ ] **Step 4: Implement the route**

In `backend/src/routes/user.routes.js`, add after the `getPortfolio` route line:

```js
router.post('/:id/reset', userController.reset);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run db:reset && npm test`
Expected: PASS — endpoint returns the reset summary; wallet/positions confirm via public endpoints; unknown user 404.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/user.controller.js backend/src/routes/user.routes.js backend/tests/reset.test.js
git commit -m "feat(step9): POST /api/users/:id/reset endpoint"
```

---

### Task 4: Docs — TODO + MEMORY

**Files:**
- Modify: `TODO.md`, `MEMORY.md`

- [ ] **Step 1: Mark Step 9 done in `TODO.md`**

In `TODO.md`, replace the Step 9 block with:

```markdown
## ✅ Step 9 — Reset / restart (panic button)
- [x] `POST /api/users/:id/reset` — liquidate positions, cancel pending orders, restore wallet to $100,000
- [x] Atomic (one transaction, wallet locked FOR UPDATE); serializes against order fills
- [x] Append-only audit trail: one RESET ledger row per position (valued at market, fallback avg buy price)
- [x] Idempotent / no-op safe on a clean account
- [x] Tests: full-reset invariants, unpriced fallback, no-op, ledger preservation, 404
```

Also update the `_Last updated:_` line near the top to `2026-07-03 (Step 9 complete)`.

- [ ] **Step 2: Update `MEMORY.md`**

In `MEMORY.md`, add this row to the Route table:

```markdown
| `POST /api/users/:id/reset` | user.routes.js | `userController.reset` | `resetService.resetAccount` |
```

And add this section after the "Leaderboard (Step 8)" section:

```markdown
## Reset / panic button (Step 9)
`POST /api/users/:id/reset` restores an account to the starting state in one
`withTransaction` (wallet locked FOR UPDATE first, so it serializes against order
fills). `resetService.resetAccount` cancels all PENDING orders
(`orderRepository.cancelAllPendingByUser`), liquidates every open position into an
append-only `RESET` ledger row (`amount = qty × price`, price = current market price
or the position's `average_buy_price` when the feed is quiet), zeroes the positions,
then forces the wallet balance to `100000.0000`. Hard reset: the balance is
definitional, not `old + Σ liquidations`; RESET rows are an audit of what was wiped.
Idempotent/no-op on a clean account. Unknown user → 404.
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md MEMORY.md
git commit -m "docs(step9): mark Step 9 complete in TODO/MEMORY"
```

---

## Self-Review

**1. Spec coverage:**
- `POST /api/users/:id/reset` → Tasks 2, 3. ✓
- Liquidate positions → per-position RESET rows at market, zero holdings → Task 2. ✓
- Cancel pending orders → Task 1 (repo) + Task 2 (wired). ✓
- Restore wallet to $100,000 → Task 2. ✓
- RESET ledger rows preserve audit trail (append-only) → Task 2 (asserts BUY rows survive). ✓
- Missing market price → fall back to average_buy_price → Task 2 (unpriced test). ✓
- Idempotent / no-op safe → Task 1 (second cancel) + Task 2 (clean-account test). ✓
- Atomic + wallet lock (serialize vs fills) → Task 2 (`withTransaction` + `findByUserIdForUpdate`). ✓
- Unknown user → 404 → Tasks 2, 3. ✓
- Docs → Task 4. ✓

**2. Placeholder scan:** No TBD / "handle edge cases" / "similar to". Every code step shows full code. ✓

**3. Type consistency:**
- `cancelAllPendingByUser(userId, client) → Array<{id}>`; consumed in Task 2 as `cancelled.length`. ✓
- `positionRepository.findByUser` rows use `asset_id`, `quantity`, `average_buy_price` — matches the service's field access. ✓
- `transactionRepository.create({ userId, orderId, transactionType, amount, pricePerShare })` — called with exactly those keys; returned row exposes `transaction_type`, `order_id`, `amount`, `price_per_share` — matches test assertions. ✓
- `resetAccount` returns `{ wallet, positionsLiquidated, ordersCancelled, resetTransactions }` — asserted identically in Tasks 2 & 3; controller nests it under `data`. ✓
- Route/controller names (`reset`, `/:id/reset`) consistent across Task 3. ✓

---

## Notes / things only the user can do

- Optional live check: with the server + DB running, `POST http://localhost:5000/api/users/<id>/reset`
  after buying a few positions and resting a limit, then eyeball `GET /api/users/<id>/wallet` (100000),
  `/positions` (empty), and the transactions ledger (original BUY/SELL rows intact + new RESET rows).
- No schema migration required — the `transactions` CHECK already permits `RESET` and `order_id` is nullable.
