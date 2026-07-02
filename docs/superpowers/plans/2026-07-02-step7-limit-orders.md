# Step 7 — Limit Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LIMIT orders — placement (rests PENDING), a tick-driven matcher that fills crossed orders at their target price (insufficient funds/holdings → REJECTED), and a cancel endpoint — without changing MARKET order behavior.

**Architecture:** Extract the shared fill core out of `placeMarketOrder` into an internal `settleFill` helper. Add `placeLimitOrder` (insert PENDING, no wallet touch), a matcher (`processLimitOrdersForSymbol` → `fillLimitOrder`) hooked into the ingestion pipeline's throttled price-update path, and `cancelOrder`. Correctness rests on `SELECT … FOR UPDATE` row locks + status rechecks.

**Tech Stack:** Node.js (CommonJS), Express 5, PostgreSQL via `pg`, `decimal.js`, Node built-in test runner.

## Global Constraints

- Language CommonJS (`require`/`module.exports`). Money/prices are strings at **4 dp** via `decimal.js` (`DECIMAL(15,4)`); use the existing `money()` helper.
- Layering `routes → controllers → services → repositories → DB`; each layer depends only on the one beneath; no business logic in controllers. Every repository method takes a trailing `client = pool`.
- Errors use `AppError(message, statusCode)`; controllers wrapped in `catchAsync`. Central handler maps PG `23505→409`, `23514`/`23502→400`, `22P02→400`.
- Trigger semantics: **BUY** fills when `price <= target_price`; **SELL** fills when `price >= target_price`. Execution price is always `target_price`.
- **No reservation** — placement touches no wallet/position; funds/holdings checked at fill; insufficient → order `REJECTED` (committed, not an error). **Full-fill only** (no partials).
- The wallet row `FOR UPDATE` is the per-user serialization point (shared with MARKET). Every fill/cancel locks the order row `FOR UPDATE` and re-checks `status` before mutating (no double-fill).
- `orders` schema already supports LIMIT (no migration): `order_type IN ('MARKET','LIMIT')`, `status IN ('PENDING','FILLED','CANCELLED','REJECTED')`, CHECK that LIMIT has a target_price and MARKET does not.
- Tests: `npm test` from `backend/` (`node --test --test-concurrency=1 "tests/**/*.test.js"`); DB via `npm run db:reset` (seed AAPL=195, MSFT=430, TSLA=250). Order-independent — use unique users; restore any shared `market_prices` a test mutates.
- Run all commands from `backend/`.

---

## File Structure

**Modify:**
- `src/services/order.service.js` — extract `settleFill`; add `placeLimitOrder`, `fillLimitOrder`, `processLimitOrdersForSymbol`, `cancelOrder`.
- `src/repositories/order.repository.js` — add `findPendingLimitByAsset`, `findByIdForUpdate`.
- `src/controllers/order.controller.js` — `place` branches on `orderType`; add `cancel`.
- `src/routes/order.routes.js` — `DELETE /:id`.
- `src/marketdata/ingestionWorker.js` — optional `onPriceUpdate` hook on the throttled path (per-symbol in-flight guard).
- `src/marketdata/runtime.js` — inject `onPriceUpdate → orderService.processLimitOrdersForSymbol`.

**Tests:**
- `tests/limitOrders.test.js` (new) — repo, placement, matcher, cancel (DB + HTTP).
- `tests/marketdata.unit.test.js` (extend) — worker hook + runtime wiring.

**Docs:** `TODO.md`, `MEMORY.md`.

---

### Task 1: Extract `settleFill` from `placeMarketOrder` (refactor, no behavior change)

**Files:**
- Modify: `backend/src/services/order.service.js`

**Interfaces:**
- Produces (internal, module-scope, not exported):
  `settleFill(client, { userId, assetId, side, qty, price }) → Promise<{ ok: true, wallet, newBalance } | { ok: false, reason: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_HOLDINGS' }>`
  — locks wallet + position `FOR UPDATE`, applies the balance/holdings check and position/wallet updates. `qty` and `price` are `Decimal`. Does NOT create the order or ledger row.
- `placeMarketOrder` keeps its exact external contract (return shape, status codes).

- [ ] **Step 1: Establish the baseline is green**

Run: `npm run db:reset && npm test`
Expected: all tests pass (34). This is a pure refactor — the existing MARKET-order tests (`scenario.test.js`, `portfolio.test.js`) are the characterization tests that must stay green. `settleFill` is internal, covered transitively.

- [ ] **Step 2: Add `settleFill` and refactor `placeMarketOrder`**

In `backend/src/services/order.service.js`, add `settleFill` as a module-level function (below the `money` helper, above `const orderService = {`):

```js
// Shared fill core for MARKET and LIMIT orders. Locks the wallet (the per-user
// serialization point) and position FOR UPDATE, then applies the balance/holdings
// check and the position + wallet mutations. Returns { ok:false, reason } for a
// business shortfall (caller decides: MARKET throws 422, LIMIT marks REJECTED) and
// throws only on true errors (missing wallet). Does not touch the order/ledger.
async function settleFill(client, { userId, assetId, side, qty, price }) {
  const grossAmount = new Decimal(price).times(qty);

  const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
  if (!wallet) throw new AppError('Wallet not found for this user.', 404);
  const balance = new Decimal(wallet.balance);
  const position = await positionRepository.findForUpdate(userId, assetId, client);

  let newBalance;
  if (side === 'BUY') {
    if (balance.lt(grossAmount)) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    newBalance = balance.minus(grossAmount);
    if (position) {
      const oldQty = new Decimal(position.quantity);
      const oldCost = oldQty.times(position.average_buy_price);
      const newQty = oldQty.plus(qty);
      const newAvg = oldCost.plus(grossAmount).div(newQty);
      await positionRepository.update(
        { userId, assetId, quantity: money(newQty), averageBuyPrice: money(newAvg) },
        client
      );
    } else {
      await positionRepository.create(
        { userId, assetId, quantity: money(qty), averageBuyPrice: money(price) },
        client
      );
    }
  } else {
    if (!position || new Decimal(position.quantity).lt(qty)) {
      return { ok: false, reason: 'INSUFFICIENT_HOLDINGS' };
    }
    newBalance = balance.plus(grossAmount);
    const remainingQty = new Decimal(position.quantity).minus(qty);
    await positionRepository.update(
      {
        userId,
        assetId,
        quantity: money(remainingQty),
        averageBuyPrice: money(position.average_buy_price),
      },
      client
    );
  }

  const updatedWallet = await walletRepository.updateBalance(userId, money(newBalance), client);
  return { ok: true, wallet: updatedWallet, newBalance: money(newBalance) };
}
```

Then replace the body of `placeMarketOrder`'s `withTransaction` callback (everything from `const user =` through the `return { order, ... }`) with this version that delegates to `settleFill`:

```js
    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const asset = await assetRepository.findBySymbol(symbol, client);
      if (!asset || !asset.is_active) throw new AppError('Asset not found or inactive.', 404);

      const priceRaw = await assetRepository.getPrice(asset.id, client);
      if (priceRaw === null) throw new AppError('No market price available for this asset.', 422);
      const price = new Decimal(priceRaw);
      const grossAmount = price.times(qty);

      const result = await settleFill(client, {
        userId, assetId: asset.id, side: normalizedSide, qty, price,
      });
      if (!result.ok) {
        throw new AppError(
          result.reason === 'INSUFFICIENT_FUNDS'
            ? 'Insufficient funds for this order.'
            : 'Insufficient asset holdings for this order.',
          422
        );
      }

      const order = await orderRepository.create(
        {
          userId,
          assetId: asset.id,
          orderType: 'MARKET',
          side: normalizedSide,
          quantity: money(qty),
          targetPrice: null,
          status: 'FILLED',
        },
        client
      );

      const transaction = await transactionRepository.create(
        {
          userId,
          orderId: order.id,
          transactionType: normalizedSide,
          amount: money(grossAmount),
          pricePerShare: money(price),
        },
        client
      );

      return {
        order,
        transaction,
        wallet: result.wallet,
        executedPrice: money(price),
        totalAmount: money(grossAmount),
      };
    });
```

- [ ] **Step 3: Run the suite to confirm no regression**

Run: `npm run db:reset && npm test`
Expected: PASS — still 34 tests; MARKET order behavior (funds check, avg price, ledger, over-draft protection) unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/order.service.js
git commit -m "refactor(step7): extract settleFill from placeMarketOrder"
```

---

### Task 2: order.repository — `findPendingLimitByAsset` + `findByIdForUpdate`

**Files:**
- Modify: `backend/src/repositories/order.repository.js`
- Test: `backend/tests/limitOrders.test.js` (new)

**Interfaces:**
- Produces:
  - `findPendingLimitByAsset(assetId, client = pool) → Promise<Array<{ id, user_id, side, quantity, target_price }>>`
  - `findByIdForUpdate(id, client = pool) → Promise<{ id, user_id, asset_id, order_type, side, quantity, target_price, status } | null>` (locks the row `FOR UPDATE`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/limitOrders.test.js`:

```js
'use strict';

// Step 7 — limit orders. Boots the app in-process and exercises the limit-order
// repository, placement, matcher and cancel. Assumes schema via `npm run db:reset`
// (seed AAPL=195). Order-independent: unique users per test; restores AAPL price.

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
  const r = await apiJson('POST', '/api/users', { username: `lim_${t}`, email: `lim_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}

test('order.repository: findPendingLimitByAsset + findByIdForUpdate', async () => {
  const userId = await registerUser();
  const aaplId = await assetIdOf('AAPL');

  const created = await orderRepository.create({
    userId, assetId: aaplId, orderType: 'LIMIT', side: 'BUY',
    quantity: '3.0000', targetPrice: '190.0000', status: 'PENDING',
  });

  const pending = await orderRepository.findPendingLimitByAsset(aaplId);
  const mine = pending.find((o) => o.id === created.id);
  assert.ok(mine, 'created pending limit is listed');
  assert.equal(mine.side, 'BUY');
  assert.equal(mine.target_price, '190.0000');

  const locked = await orderRepository.findByIdForUpdate(created.id);
  assert.equal(locked.status, 'PENDING');
  assert.equal(locked.order_type, 'LIMIT');
  assert.equal(locked.user_id, userId);

  assert.equal(await orderRepository.findByIdForUpdate('00000000-0000-0000-0000-000000000000'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:reset && npm test`
Expected: FAIL — `orderRepository.findPendingLimitByAsset is not a function`.

- [ ] **Step 3: Implement the repo methods**

In `backend/src/repositories/order.repository.js`, add inside `orderRepository` (after `updateStatus`, keeping trailing-comma style):

```js
  // PENDING limit orders for one asset — the matcher's candidate set per tick.
  async findPendingLimitByAsset(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, side, quantity, target_price
       FROM orders
       WHERE asset_id = $1 AND order_type = 'LIMIT' AND status = 'PENDING'`,
      [assetId]
    );
    return rows;
  },

  // Locks a single order row so a fill/cancel can re-check status before mutating.
  async findByIdForUpdate(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, asset_id, order_type, side, quantity, target_price, status
       FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] || null;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/order.repository.js backend/tests/limitOrders.test.js
git commit -m "feat(step7): order repo — pending-by-asset + row lock"
```

---

### Task 3: `placeLimitOrder` + controller branch + validation

**Files:**
- Modify: `backend/src/services/order.service.js`, `backend/src/controllers/order.controller.js`
- Test: `backend/tests/limitOrders.test.js`

**Interfaces:**
- Consumes: `userRepository.findById`, `assetRepository.findBySymbol`, `orderRepository.create`.
- Produces:
  - `orderService.placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) → Promise<order>` (status `PENDING`; no wallet/position writes).
  - `orderController.place` — branches on `req.body.orderType` (`'LIMIT'` → limit, else MARKET; unknown type → 400).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/limitOrders.test.js`:

```js
test('POST /api/orders LIMIT: creates PENDING with no wallet change', async () => {
  const userId = await registerUser();

  const before = await apiJson('GET', `/api/users/${userId}/wallet`);
  const startBalance = before.body.data.balance;

  const r = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 2, orderType: 'LIMIT', targetPrice: 150,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.order.order_type, 'LIMIT');
  assert.equal(r.body.data.order.status, 'PENDING');
  assert.equal(r.body.data.order.target_price, '150.0000');

  const afterW = await apiJson('GET', `/api/users/${userId}/wallet`);
  assert.equal(afterW.body.data.balance, startBalance, 'wallet unchanged at placement');
});

test('POST /api/orders LIMIT: validation errors', async () => {
  const userId = await registerUser();
  const bad = (body) => apiJson('POST', '/api/orders', { userId, symbol: 'AAPL', ...body });

  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT' })).status, 400); // no target
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 0 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: -5 })).status, 400);
  assert.equal((await bad({ side: 'HOLD', quantity: 1, orderType: 'LIMIT', targetPrice: 10 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 0, orderType: 'LIMIT', targetPrice: 10 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'FOO', targetPrice: 10 })).status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — LIMIT request returns 500/uncaught or wrong shape (`placeLimitOrder` missing; controller only handles MARKET).

- [ ] **Step 3: Implement `placeLimitOrder`**

In `backend/src/services/order.service.js`, add inside `orderService` (after `placeMarketOrder`, before `listOrders`):

```js
  // Places a resting LIMIT order (status PENDING). No reservation: the wallet and
  // positions are untouched until the matcher fills it. Validation mirrors MARKET
  // plus a required, positive targetPrice.
  async placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) {
    if (!userId || !symbol || !side || quantity === undefined) {
      throw new AppError('userId, symbol, side and quantity are required.', 400);
    }
    const normalizedSide = String(side).toUpperCase();
    if (!['BUY', 'SELL'].includes(normalizedSide)) {
      throw new AppError('side must be BUY or SELL.', 400);
    }
    let qty;
    try {
      qty = new Decimal(quantity);
    } catch (e) {
      throw new AppError('quantity must be a number.', 400);
    }
    if (qty.lte(0)) throw new AppError('quantity must be greater than zero.', 400);

    if (targetPrice === undefined || targetPrice === null || targetPrice === '') {
      throw new AppError('targetPrice is required for a LIMIT order.', 400);
    }
    let target;
    try {
      target = new Decimal(targetPrice);
    } catch (e) {
      throw new AppError('targetPrice must be a number.', 400);
    }
    if (target.lte(0)) throw new AppError('targetPrice must be greater than zero.', 400);

    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const asset = await assetRepository.findBySymbol(symbol, client);
      if (!asset || !asset.is_active) throw new AppError('Asset not found or inactive.', 404);

      return orderRepository.create(
        {
          userId,
          assetId: asset.id,
          orderType: 'LIMIT',
          side: normalizedSide,
          quantity: money(qty),
          targetPrice: money(target),
          status: 'PENDING',
        },
        client
      );
    });
  },
```

- [ ] **Step 4: Branch the controller on orderType**

Replace `placeMarket` in `backend/src/controllers/order.controller.js` with a `place` handler (and update the export/comment):

```js
  // POST /api/orders  { userId, symbol, side, quantity, orderType?, targetPrice? }
  // orderType defaults to MARKET (immediate fill); LIMIT rests as PENDING.
  place: catchAsync(async (req, res) => {
    const { userId, symbol, side, quantity, orderType, targetPrice } = req.body;
    const type = orderType ? String(orderType).toUpperCase() : 'MARKET';
    if (!['MARKET', 'LIMIT'].includes(type)) {
      throw new AppError('orderType must be MARKET or LIMIT.', 400);
    }
    const data =
      type === 'LIMIT'
        ? { order: await orderService.placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) }
        : await orderService.placeMarketOrder({ userId, symbol, side, quantity });
    res.status(201).json({ status: 'success', data });
  }),
```

Add the `AppError` require at the top of the controller (it currently imports only `orderService` and `catchAsync`):

```js
const AppError = require('../utils/AppError');
```

- [ ] **Step 5: Point the route at `place`**

In `backend/src/routes/order.routes.js`, change the POST line:

```js
router.post('/', orderController.place);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — LIMIT placement + validation green; MARKET path (existing `scenario.test.js`) still passes via the renamed `place` handler.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/order.service.js backend/src/controllers/order.controller.js backend/src/routes/order.routes.js backend/tests/limitOrders.test.js
git commit -m "feat(step7): place LIMIT orders (PENDING) + controller branch"
```

---

### Task 4: Matcher — `fillLimitOrder` + `processLimitOrdersForSymbol`

**Files:**
- Modify: `backend/src/services/order.service.js`
- Test: `backend/tests/limitOrders.test.js`

**Interfaces:**
- Consumes: `orderRepository.findByIdForUpdate`, `orderRepository.findPendingLimitByAsset`, `orderRepository.updateStatus`, `assetRepository.findBySymbol`, `assetRepository.getPrice`, `settleFill`, `transactionRepository.create`.
- Produces:
  - `orderService.fillLimitOrder(orderId) → Promise<'FILLED' | 'REJECTED' | 'SKIPPED'>` — one transaction; locks the order row, re-checks it is still PENDING and still crossed at the current market price, fills at `target_price` via `settleFill` (→ FILLED + ledger) or marks REJECTED on shortfall; SKIPPED if no longer eligible.
  - `orderService.processLimitOrdersForSymbol({ symbol, price }) → Promise<{ filled, rejected }>` — resolves the asset, loads PENDING limits, fills those crossed at `price`. Never throws (pipeline-safe); per-order errors are logged.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/limitOrders.test.js`:

```js
const orderService = require('../src/services/order.service');

// Set the shared market price for a symbol, run the matcher, then the caller
// restores the seed. getPrice (used inside fillLimitOrder) reads this row.
async function setPrice(symbol, price) {
  const id = await assetIdOf(symbol);
  await marketPriceRepository.upsertLatest(id, price);
}

async function walletBalance(userId) {
  const r = await apiJson('GET', `/api/users/${userId}/wallet`);
  return r.body.data.balance;
}

test('matcher: BUY limit fills at target when price crosses down', async () => {
  const userId = await registerUser();
  const start = await walletBalance(userId);

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 2, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000'); // 189 <= 190 -> crosses
  const res = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(res, { filled: 1, rejected: 0 });

  const locked = await orderRepository.findByIdForUpdate(orderId);
  assert.equal(locked.status, 'FILLED');
  // Filled at target 190, qty 2 -> debit 380.
  const expected = (Number(start) - 380).toFixed(4);
  assert.equal(await walletBalance(userId), expected);

  await setPrice('AAPL', '195.0000'); // restore seed
});

test('matcher: SELL limit fills at target when price crosses up; not-crossed stays PENDING', async () => {
  const userId = await registerUser();
  // Give the user shares: BUY 5 AAPL at market (195).
  await apiJson('POST', '/api/orders', { userId, symbol: 'AAPL', side: 'BUY', quantity: 5 });

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'SELL', quantity: 5, orderType: 'LIMIT', targetPrice: 210,
  });
  const orderId = placed.body.data.order.id;

  // Price below target -> no cross.
  await setPrice('AAPL', '200.0000');
  assert.deepEqual(
    await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '200.0000' }),
    { filled: 0, rejected: 0 }
  );
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'PENDING');

  // Price at/above target -> fills.
  await setPrice('AAPL', '210.0000');
  assert.deepEqual(
    await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '210.0000' }),
    { filled: 1, rejected: 0 }
  );
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'FILLED');

  await setPrice('AAPL', '195.0000');
});

test('matcher: insufficient funds at fill -> REJECTED, wallet unchanged', async () => {
  const userId = await registerUser();
  const start = await walletBalance(userId); // 100000

  // Target 190, qty 1000 -> needs 190000 > 100000 at fill.
  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 1000, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000');
  const res = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(res, { filled: 0, rejected: 1 });
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'REJECTED');
  assert.equal(await walletBalance(userId), start, 'wallet unchanged on reject');

  await setPrice('AAPL', '195.0000');
});

test('matcher: idempotent — running twice fills a crossed order once', async () => {
  const userId = await registerUser();
  const start = await walletBalance(userId);

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000');
  const first = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  const second = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(first, { filled: 1, rejected: 0 });
  assert.deepEqual(second, { filled: 0, rejected: 0 }); // already FILLED -> not re-listed

  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'FILLED');
  const expected = (Number(start) - 190).toFixed(4); // debited once
  assert.equal(await walletBalance(userId), expected);

  await setPrice('AAPL', '195.0000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `orderService.processLimitOrdersForSymbol is not a function`.

- [ ] **Step 3: Implement the matcher**

In `backend/src/services/order.service.js`, add inside `orderService` (after `placeLimitOrder`):

```js
  // Fills one PENDING limit order in its own transaction. Locks the order row and
  // re-checks it is still PENDING and still crossed at the current market price
  // (guards against a concurrent fill/cancel), then settles at target_price.
  // Returns FILLED, REJECTED (shortfall) or SKIPPED (no longer eligible).
  async fillLimitOrder(orderId) {
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.status !== 'PENDING' || order.order_type !== 'LIMIT') return 'SKIPPED';

      const priceRaw = await assetRepository.getPrice(order.asset_id, client);
      if (priceRaw === null) return 'SKIPPED';
      const price = new Decimal(priceRaw);
      const target = new Decimal(order.target_price);
      const crossed = order.side === 'BUY' ? price.lte(target) : price.gte(target);
      if (!crossed) return 'SKIPPED';

      const qty = new Decimal(order.quantity);
      const result = await settleFill(client, {
        userId: order.user_id, assetId: order.asset_id, side: order.side, qty, price: target,
      });
      if (!result.ok) {
        await orderRepository.updateStatus(orderId, 'REJECTED', client);
        return 'REJECTED';
      }

      await orderRepository.updateStatus(orderId, 'FILLED', client);
      await transactionRepository.create(
        {
          userId: order.user_id,
          orderId,
          transactionType: order.side,
          amount: money(target.times(qty)),
          pricePerShare: money(target),
        },
        client
      );
      return 'FILLED';
    });
  },

  // Matcher entry point, called from the ingestion pipeline on each throttled
  // price update. Loads the symbol's PENDING limits, fills those crossed at
  // `price`. Pipeline-safe: never throws; per-order failures are logged.
  async processLimitOrdersForSymbol({ symbol, price }) {
    let filled = 0;
    let rejected = 0;
    try {
      const asset = await assetRepository.findBySymbol(symbol);
      if (!asset || !asset.is_active) return { filled, rejected };
      const p = new Decimal(price);

      const pending = await orderRepository.findPendingLimitByAsset(asset.id);
      for (const o of pending) {
        const target = new Decimal(o.target_price);
        const crossed = o.side === 'BUY' ? p.lte(target) : p.gte(target);
        if (!crossed) continue;
        try {
          const outcome = await orderService.fillLimitOrder(o.id);
          if (outcome === 'FILLED') filled += 1;
          else if (outcome === 'REJECTED') rejected += 1;
        } catch (err) {
          console.error(`Limit fill failed for order ${o.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`Limit matcher failed for ${symbol}:`, err.message);
    }
    return { filled, rejected };
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — BUY/SELL fills at target, not-crossed stays PENDING, insufficient → REJECTED, idempotent double-run fills once.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/order.service.js backend/tests/limitOrders.test.js
git commit -m "feat(step7): limit-order matcher (fill on cross at target)"
```

---

### Task 5: `cancelOrder` + DELETE endpoint

**Files:**
- Modify: `backend/src/services/order.service.js`, `backend/src/controllers/order.controller.js`, `backend/src/routes/order.routes.js`
- Test: `backend/tests/limitOrders.test.js`

**Interfaces:**
- Consumes: `orderRepository.findByIdForUpdate`, `orderRepository.updateStatus`.
- Produces:
  - `orderService.cancelOrder({ orderId, userId }) → Promise<{ id, status }>` — PENDING → CANCELLED; not owner/missing → 404; not pending → 409.
  - `orderController.cancel` — `DELETE /api/orders/:id?userId=…`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/limitOrders.test.js`:

```js
test('DELETE /api/orders/:id cancels a PENDING order', async () => {
  const userId = await registerUser();
  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 150,
  });
  const orderId = placed.body.data.order.id;

  const cancel = await apiJson('DELETE', `/api/orders/${orderId}?userId=${userId}`);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.data.status, 'CANCELLED');
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'CANCELLED');

  // Cancelling again -> 409 (not pending).
  assert.equal((await apiJson('DELETE', `/api/orders/${orderId}?userId=${userId}`)).status, 409);
});

test('DELETE /api/orders/:id — wrong user 404, missing userId 400', async () => {
  const owner = await registerUser();
  const other = await registerUser();
  const placed = await apiJson('POST', '/api/orders', {
    owner, symbol: 'AAPL', side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 150,
    userId: owner,
  });
  const orderId = placed.body.data.order.id;

  assert.equal((await apiJson('DELETE', `/api/orders/${orderId}?userId=${other}`)).status, 404);
  assert.equal((await apiJson('DELETE', `/api/orders/${orderId}`)).status, 400); // no userId
  // Still cancellable by the owner afterwards.
  assert.equal((await apiJson('DELETE', `/api/orders/${orderId}?userId=${owner}`)).status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `DELETE /api/orders/:id` returns 404 (route not mounted).

- [ ] **Step 3: Implement `cancelOrder`**

In `backend/src/services/order.service.js`, add inside `orderService` (after `processLimitOrdersForSymbol`):

```js
  // Cancels a still-PENDING order. Locks the row and verifies ownership + status
  // before flipping to CANCELLED, so it can't race a concurrent fill.
  async cancelOrder({ orderId, userId }) {
    if (!userId) throw new AppError('userId query parameter is required.', 400);
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.user_id !== userId) throw new AppError('Order not found.', 404);
      if (order.status !== 'PENDING') {
        throw new AppError('Only pending orders can be cancelled.', 409);
      }
      return orderRepository.updateStatus(orderId, 'CANCELLED', client);
    });
  },
```

- [ ] **Step 4: Add the controller handler**

In `backend/src/controllers/order.controller.js`, add inside `orderController` (after `place`):

```js
  // DELETE /api/orders/:id?userId=...  — cancel a pending order.
  cancel: catchAsync(async (req, res) => {
    const order = await orderService.cancelOrder({
      orderId: req.params.id,
      userId: req.query.userId,
    });
    res.status(200).json({ status: 'success', data: order });
  }),
```

- [ ] **Step 5: Mount the route**

In `backend/src/routes/order.routes.js`, add (after the POST line):

```js
router.delete('/:id', orderController.cancel);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — cancel happy path, 409 on re-cancel, 404 wrong user, 400 missing userId.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/order.service.js backend/src/controllers/order.controller.js backend/src/routes/order.routes.js backend/tests/limitOrders.test.js
git commit -m "feat(step7): cancel pending order (DELETE /api/orders/:id)"
```

---

### Task 6: Wire the matcher into the ingestion pipeline

**Files:**
- Modify: `backend/src/marketdata/ingestionWorker.js`, `backend/src/marketdata/runtime.js`
- Test: `backend/tests/marketdata.unit.test.js`

**Interfaces:**
- Consumes: `orderService.processLimitOrdersForSymbol` (via runtime dep).
- Produces:
  - `createIngestionWorker({ ..., onPriceUpdate })` — when provided, called as `onPriceUpdate({ symbol, price })` on the throttled write path, guarded by a per-symbol in-flight flag; hook errors are caught and logged. Absent → no-op.
  - `createMarketRuntime` passes `onPriceUpdate: ({ symbol, price }) => processLimitOrdersForSymbol({ symbol, price })` (dep-injectable, default `orderService.processLimitOrdersForSymbol`) to the worker.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
test('ingestionWorker: calls onPriceUpdate on the throttled path, guarded per symbol', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const src = fakeSource();
  let clock = 1000;

  const worker = createIngestionWorker({
    tickSource: src,
    marketPriceRepository: { upsertLatest: async () => {} },
    priceHistoryRepository: { append: async () => {} },
    marketSocket: { broadcast: () => {} },
    assetIdBySymbol: new Map([['AAPL', 'aapl-id']]),
    throttleMs: 1000,
    now: () => clock,
    onPriceUpdate: (u) => { calls.push(u); return gate; }, // stays in-flight until released
  });
  worker.start();

  src.push({ symbol: 'AAPL', price: '100.0000', ts: 't1' }); // clock 1000 -> write + matcher (in-flight)
  src.push({ symbol: 'AAPL', price: '101.0000', ts: 't2' }); // throttled -> no matcher
  clock = 2000;
  src.push({ symbol: 'AAPL', price: '102.0000', ts: 't3' }); // eligible but AAPL in-flight -> skipped
  assert.deepEqual(calls, [{ symbol: 'AAPL', price: '100.0000' }]);

  release();
  await new Promise((r) => setImmediate(r)); // let the in-flight promise settle
  clock = 3000;
  src.push({ symbol: 'AAPL', price: '103.0000', ts: 't4' }); // no longer in-flight -> matcher runs
  assert.deepEqual(calls, [
    { symbol: 'AAPL', price: '100.0000' },
    { symbol: 'AAPL', price: '103.0000' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `onPriceUpdate` is never called (`calls` stays empty).

- [ ] **Step 3: Add the hook to the worker**

In `backend/src/marketdata/ingestionWorker.js`, add `onPriceUpdate` to the destructured options and an in-flight guard. Update the factory signature:

```js
function createIngestionWorker({
  tickSource,
  marketPriceRepository,
  priceHistoryRepository,
  marketSocket,
  assetIdBySymbol,
  throttleMs = 1000,
  now = () => Date.now(),
  onPriceUpdate = null,
}) {
  const lastWriteAt = new Map(); // symbol -> ms timestamp of last DB write
  const matching = new Set(); // symbols with an in-flight matcher run
```

Add a `runMatcher` helper (below `persist`):

```js
  function runMatcher(symbol, price) {
    if (!onPriceUpdate || matching.has(symbol)) return;
    matching.add(symbol);
    Promise.resolve()
      .then(() => onPriceUpdate({ symbol, price }))
      .catch((err) => console.error('Limit matcher hook failed:', err.message))
      .finally(() => matching.delete(symbol));
  }
```

In `handleTick`, after `void persist(assetId, tick);`, add:

```js
    runMatcher(tick.symbol, tick.price);
```

- [ ] **Step 4: Run the worker test to verify it passes**

Run: `npm test`
Expected: PASS — matcher called on t1 and t4 only.

- [ ] **Step 5: Wire runtime → matcher**

In `backend/src/marketdata/runtime.js`, add the service require at the top:

```js
const orderServiceDefault = require('../services/order.service');
```

Add `processLimitOrdersForSymbol` to the `deps` destructuring (with a default):

```js
    processLimitOrdersForSymbol = orderServiceDefault.processLimitOrdersForSymbol,
```

Pass `onPriceUpdate` into `createIngestionWorker` (add the property to the existing call):

```js
  const worker = createIngestionWorker({
    tickSource: source,
    marketPriceRepository,
    priceHistoryRepository,
    marketSocket,
    assetIdBySymbol: buildAssetIdBySymbol(assets),
    throttleMs,
    onPriceUpdate: ({ symbol, price }) => processLimitOrdersForSymbol({ symbol, price }),
  });
```

- [ ] **Step 6: Add a runtime wiring test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
test('createMarketRuntime: wires onPriceUpdate to processLimitOrdersForSymbol', () => {
  const matcherCalls = [];
  let capturedOpts = null;
  createMarketRuntime({
    assets: [{ id: 'a1', symbol: 'AAPL' }],
    latestPrices: [{ symbol: 'AAPL', price: '100' }],
    apiKey: '',
    isMarketOpen: false,
    marketSocket: { broadcast() {} },
    deps: {
      createTickSource: ({ makeSimulated }) => ({ source: makeSimulated(), mode: 'simulated' }),
      createSimulatedTickSource: () => ({ onTick() {}, start() {}, stop() {} }),
      createFinnhubTickSource: () => ({ onTick() {}, start() {}, stop() {} }),
      createIngestionWorker: (opts) => { capturedOpts = opts; return { start() {}, stop() {} }; },
      marketPriceRepository: {},
      priceHistoryRepository: {},
      processLimitOrdersForSymbol: (u) => { matcherCalls.push(u); },
    },
  });
  assert.equal(typeof capturedOpts.onPriceUpdate, 'function');
  capturedOpts.onPriceUpdate({ symbol: 'AAPL', price: '99' });
  assert.deepEqual(matcherCalls, [{ symbol: 'AAPL', price: '99' }]);
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — worker hook + runtime wiring green; full suite still passes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/marketdata/ingestionWorker.js backend/src/marketdata/runtime.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step7): run limit matcher on each throttled price update"
```

---

### Task 7: Docs — TODO + MEMORY

**Files:**
- Modify: `TODO.md`, `MEMORY.md`

- [ ] **Step 1: Mark Step 7 done in `TODO.md`**

In `TODO.md`, replace the Step 7 block:

```markdown
## ✅ Step 7 — Limit orders
- [x] Accept LIMIT orders (status `PENDING`, store `target_price`) via `POST /api/orders`
- [x] Tick-driven matcher: fill PENDING limits at target when price crosses (BUY ≤, SELL ≥); insufficient → REJECTED
- [x] `DELETE /api/orders/:id` — cancel a pending order
- [x] Tests: fill-on-cross, reject, idempotency, cancel, validation
```

Also update the `_Last updated:_` line near the top to `2026-07-02 (Step 7 complete)`.

- [ ] **Step 2: Update `MEMORY.md`**

In `MEMORY.md`, add these rows to the Route table (after the existing order rows):

```markdown
| `DELETE /api/orders/:id` | order.routes.js | `orderController.cancel` | `orderService.cancelOrder` |
```

(The `POST /api/orders` row now also covers LIMIT — no new row needed.)

Add this section after the "Market data pipeline (Step 6a)" section:

```markdown
## Limit orders (Step 7)
`POST /api/orders` with `orderType:'LIMIT'` + `targetPrice` rests an order as PENDING
(no funds reserved). `order.service.js settleFill()` is the shared fill core used by
both MARKET and LIMIT paths (wallet FOR UPDATE + funds/holdings check + position/wallet
update). The matcher `processLimitOrdersForSymbol({symbol,price})` runs from the
ingestion pipeline on each throttled price update (`ingestionWorker` `onPriceUpdate`
hook, per-symbol in-flight guard, wired in `runtime.js`); it fills crossed orders via
`fillLimitOrder(orderId)` at `target_price` (BUY when price≤target, SELL when ≥),
locking the order row + rechecking status for idempotency, and marks REJECTED on a
funds/holdings shortfall. `DELETE /api/orders/:id?userId=` cancels a PENDING order.
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md MEMORY.md
git commit -m "docs(step7): mark Step 7 complete in TODO/MEMORY"
```

---

## Self-Review

**1. Spec coverage:**
- No reservation; check-at-fill; insufficient → REJECTED → Task 4. ✓
- Fill at target price → Task 4 (`fillLimitOrder` settles at `target`). ✓
- Tick-driven per-symbol matcher → Task 6 (worker hook) + Task 4 (matcher). ✓
- Full-fill only (no partial machinery) → Tasks 3–4. ✓
- Trigger semantics BUY ≤ / SELL ≥ → Tasks 4 (both pre-filter and authoritative recheck). ✓
- Shared `settleFill` DRY refactor → Task 1. ✓
- Placement `POST` branch + validation → Task 3. ✓
- Cancel `DELETE /:id?userId=` (404 wrong user, 409 not pending) → Task 5. ✓
- Concurrency/idempotency (order row FOR UPDATE + status recheck; wallet FOR UPDATE; per-symbol in-flight) → Tasks 2, 4, 6. ✓
- Test matrix (placement, BUY/SELL fill, not-crossed, reject, idempotent, cancel, validation, worker hook, runtime wiring) → Tasks 2–6. ✓
- Docs → Task 7. ✓

**2. Placeholder scan:** No TBD/"handle edge cases"/"similar to". Every code step shows full code. ✓

**3. Type consistency:** `settleFill(client, {userId, assetId, side, qty, price})` returns `{ok, wallet?, newBalance?, reason?}` — used identically in Task 1 (market) and Task 4 (limit). `fillLimitOrder → 'FILLED'|'REJECTED'|'SKIPPED'` and `processLimitOrdersForSymbol → {filled, rejected}` consistent between Task 4 definitions, Task 4 tests, and Task 6 wiring. `findByIdForUpdate` / `findPendingLimitByAsset` signatures match between Task 2 (repo), Task 4 (matcher), Task 5 (cancel). Controller `place`/`cancel` match routes in Tasks 3/5. `onPriceUpdate({symbol, price})` consistent between worker (Task 6), runtime (Task 6), and matcher signature (Task 4). ✓

---

## Notes / things only the user can do

- The end-to-end live path (a limit order filling from real simulator/Finnhub ticks) is exercised by the deterministic matcher tests calling `processLimitOrdersForSymbol` directly; watching it fill against the live feed in a running server is an optional manual check (`npm start`, place a LIMIT near the current price, watch it fill within ~1s).
