# Step 8 — Leaderboard & Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/leaderboard?limit=` — users ranked by total equity (cash + holdings at current market price), with ROI and an unpriced-holdings flag per entry.

**Architecture:** One aggregation query ranks all users by equity in SQL (which equals ROI order given the fixed $100k start); a service validates `limit`, computes ROI/equity at 4 dp, and shapes the ranked entries. A new `repository → service → controller → route` slice, mounted at `/api/leaderboard`.

**Tech Stack:** Node.js (CommonJS), Express 5, PostgreSQL via `pg`, `decimal.js`, Node built-in test runner.

## Global Constraints

- Language CommonJS. Money/percentages are strings at **4 dp** via `decimal.js`.
- `STARTING_CAPITAL = 100000` (wallet default; no deposits). `roiPct = (equity − 100000) / 100000 × 100`.
- Ranking is by total equity DESC, tie-broken by `created_at ASC, id ASC` (deterministic). Equity order ≡ ROI order.
- Unpriced holdings (no `market_prices` row) are excluded from equity (SUM skips NULL products) and flagged via `hasUnpricedHoldings`.
- `limit`: default 50; if provided must be an integer in `[1, 200]`, else `AppError('limit must be an integer between 1 and 200.', 400)`.
- Layering `routes → controllers → services → repositories → DB`; repo methods take a trailing `client = pool`; controllers wrapped in `catchAsync`; errors via `AppError`.
- Tests: `npm test` from `backend/` (`node --test --test-concurrency=1 "tests/**/*.test.js"`); DB via `npm run db:reset` (seed AAPL=195, MSFT=430, TSLA=250, each active + priced). The leaderboard is global — tests assert **relative** ordering among their own uniquely-created users (found by id), never absolute ranks; restore any shared `market_prices` they mutate.
- Run all commands from `backend/`.

---

## File Structure

**Create:**
- `src/repositories/leaderboard.repository.js` — `findRankedByEquity(limit)` aggregation.
- `src/services/leaderboard.service.js` — validate `limit`, shape ranked entries.
- `src/controllers/leaderboard.controller.js` — HTTP adapter.
- `src/routes/leaderboard.routes.js` — `GET /`.
- `tests/leaderboard.test.js` — repo + service + HTTP.

**Modify:**
- `src/routes/index.js` — mount `/leaderboard`.
- `TODO.md`, `MEMORY.md`.

---

### Task 1: `leaderboard.repository` — ranked aggregation

**Files:**
- Create: `backend/src/repositories/leaderboard.repository.js`
- Test: `backend/tests/leaderboard.test.js` (new)

**Interfaces:**
- Produces: `findRankedByEquity(limit, client = pool) → Promise<Array<{ id, username, created_at, balance, holdings_value, has_unpriced }>>` — all users ranked by `balance + Σ(quantity × price)` DESC (unpriced products excluded), tie-broken `created_at ASC, id ASC`, capped at `limit` rows.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/leaderboard.test.js`:

```js
'use strict';

// Step 8 — leaderboard. Boots the app in-process and exercises the ranking
// repository, service and endpoint. The leaderboard is global, so tests assert
// RELATIVE order among their own users (found by id) and restore any seed prices
// they mutate (AAPL=195, MSFT=430, TSLA=250). Schema via `npm run db:reset`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');
const leaderboardRepository = require('../src/repositories/leaderboard.repository');
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
  const r = await apiJson('POST', '/api/users', { username: `lb_${t}`, email: `lb_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function buy(userId, symbol, quantity) {
  const r = await apiJson('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });
  assert.equal(r.status, 201, `buy: ${JSON.stringify(r.body)}`);
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

test('leaderboard.repository: ranks by equity desc, flags unpriced holdings', async () => {
  const winner = await registerUser();
  await buy(winner, 'AAPL', 10); // cost 1950 @195 -> cash 98050
  const flat = await registerUser(); // cash only, 100000

  await setPrice('AAPL', '300.0000'); // winner holdings 3000 -> equity 101050
  const rows = await leaderboardRepository.findRankedByEquity(200);
  const w = rows.find((r) => r.id === winner);
  const f = rows.find((r) => r.id === flat);
  assert.ok(w && f, 'both users present');
  assert.ok(rows.indexOf(w) < rows.indexOf(f), 'winner ranks above cash-only');
  assert.equal(Number(w.holdings_value), 3000);
  assert.equal(w.has_unpriced, false);
  await setPrice('AAPL', '195.0000'); // restore

  // Unpriced: hold TSLA then remove its price row.
  const orphan = await registerUser();
  await buy(orphan, 'TSLA', 1); // needs price at buy time (250)
  await deletePrice('TSLA');
  const rows2 = await leaderboardRepository.findRankedByEquity(200);
  const o = rows2.find((r) => r.id === orphan);
  assert.equal(o.has_unpriced, true);
  assert.equal(Number(o.holdings_value), 0, 'unpriced holding excluded from value');
  await setPrice('TSLA', '250.0000'); // restore
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:reset && npm test`
Expected: FAIL — `Cannot find module '../src/repositories/leaderboard.repository'`.

- [ ] **Step 3: Implement the repository**

Create `backend/src/repositories/leaderboard.repository.js`:

```js
const pool = require('../config/database');

// Read-only ranking aggregation. Every user (with their wallet) is valued as
// cash + Σ(holding qty × latest price); unpriced holdings (no market_prices row)
// contribute NULL to the SUM and are skipped, matching the portfolio total, and
// are surfaced via has_unpriced. Ordered by equity DESC with a deterministic
// tie-break so ranks are stable.
const leaderboardRepository = {
  async findRankedByEquity(limit, client = pool) {
    const { rows } = await client.query(
      `SELECT u.id, u.username, u.created_at, w.balance,
              COALESCE(SUM(p.quantity * m.price), 0) AS holdings_value,
              BOOL_OR(p.asset_id IS NOT NULL AND m.price IS NULL) AS has_unpriced
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       LEFT JOIN positions p ON p.user_id = u.id AND p.quantity > 0
       LEFT JOIN market_prices m ON m.asset_id = p.asset_id
       GROUP BY u.id, u.username, u.created_at, w.balance
       ORDER BY (w.balance + COALESCE(SUM(p.quantity * m.price), 0)) DESC,
                u.created_at ASC, u.id ASC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },
};

module.exports = leaderboardRepository;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — winner ranks above cash-only; unpriced TSLA holding flagged and valued 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/leaderboard.repository.js backend/tests/leaderboard.test.js
git commit -m "feat(step8): leaderboard ranking aggregation query"
```

---

### Task 2: `leaderboard.service` — validation + shaping

**Files:**
- Create: `backend/src/services/leaderboard.service.js`
- Test: `backend/tests/leaderboard.test.js`

**Interfaces:**
- Consumes: `leaderboardRepository.findRankedByEquity`.
- Produces: `getLeaderboard({ limit }) → Promise<Array<{ rank, userId, username, totalEquity, roiPct, hasUnpricedHoldings }>>` — `rank` 1-based; `totalEquity`/`roiPct` are 4 dp strings. Invalid `limit` → `AppError(400)` (before any DB access).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/leaderboard.test.js`:

```js
const leaderboardService = require('../src/services/leaderboard.service');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('leaderboard.service.getLeaderboard: rejects bad limit before DB', async () => {
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '0' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: 'abc' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '999' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '1.5' }), 400);
});

test('leaderboard.service.getLeaderboard: shapes rank, equity, ROI, unpriced flag', async () => {
  const winner = await registerUser();
  await buy(winner, 'AAPL', 10); // @195 -> cash 98050
  const flat = await registerUser(); // cash 100000
  const loser = await registerUser();
  await buy(loser, 'MSFT', 10); // @430 -> cash 95700

  await setPrice('AAPL', '300.0000'); // winner holdings 3000 -> equity 101050
  await setPrice('MSFT', '300.0000'); // loser holdings 3000 -> equity 98700

  const board = await leaderboardService.getLeaderboard({ limit: 200 });
  const w = board.find((e) => e.userId === winner);
  const f = board.find((e) => e.userId === flat);
  const l = board.find((e) => e.userId === loser);

  assert.equal(w.totalEquity, '101050.0000');
  assert.equal(w.roiPct, '1.0500');
  assert.equal(w.hasUnpricedHoldings, false);
  assert.equal(f.totalEquity, '100000.0000');
  assert.equal(f.roiPct, '0.0000');
  assert.equal(l.totalEquity, '98700.0000');
  assert.equal(l.roiPct, '-1.3000');

  // Relative ranks: winner < flat < loser.
  assert.ok(w.rank < f.rank && f.rank < l.rank, `${w.rank} < ${f.rank} < ${l.rank}`);
  // Ranks are 1-based and strictly increasing down the returned list.
  assert.equal(board[0].rank, 1);
  assert.equal(board[board.length - 1].rank, board.length);

  await setPrice('AAPL', '195.0000');
  await setPrice('MSFT', '430.0000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/services/leaderboard.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/leaderboard.service.js`:

```js
const Decimal = require('decimal.js');

const AppError = require('../utils/AppError');
const leaderboardRepository = require('../repositories/leaderboard.repository');

const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);
const pct = (value) => new Decimal(value).toFixed(SCALE);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// ROI baseline — the wallet's default starting cash (no deposits exist).
const STARTING_CAPITAL = '100000';

const leaderboardService = {
  // Ranked users by total equity (cash + holdings at current price). Since every
  // account starts at STARTING_CAPITAL with no deposits, equity order equals ROI
  // order — we rank by equity and derive ROI for display.
  async getLeaderboard({ limit } = {}) {
    const n = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      throw new AppError(`limit must be an integer between 1 and ${MAX_LIMIT}.`, 400);
    }

    const rows = await leaderboardRepository.findRankedByEquity(n);
    const start = new Decimal(STARTING_CAPITAL);

    return rows.map((row, index) => {
      const equity = new Decimal(row.balance).plus(row.holdings_value);
      const roi = equity.minus(start).div(start).times(100);
      return {
        rank: index + 1,
        userId: row.id,
        username: row.username,
        totalEquity: money(equity),
        roiPct: pct(roi),
        hasUnpricedHoldings: row.has_unpriced,
      };
    });
  },
};

module.exports = leaderboardService;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — validation rejects; winner/flat/loser equity, ROI, ranks, and flag exact.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/leaderboard.service.js backend/tests/leaderboard.test.js
git commit -m "feat(step8): leaderboard service (limit validation + ROI shaping)"
```

---

### Task 3: controller + route + mount

**Files:**
- Create: `backend/src/controllers/leaderboard.controller.js`, `backend/src/routes/leaderboard.routes.js`
- Modify: `backend/src/routes/index.js`
- Test: `backend/tests/leaderboard.test.js`

**Interfaces:**
- Consumes: `leaderboardService.getLeaderboard`.
- Produces route `GET /api/leaderboard?limit=` → `{ status:'success', results, data: [entries] }`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/leaderboard.test.js`:

```js
test('GET /api/leaderboard returns ranked entries with the expected shape', async () => {
  const r = await apiJson('GET', '/api/leaderboard');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'success');
  assert.ok(Array.isArray(r.body.data));
  assert.equal(r.body.results, r.body.data.length);
  const first = r.body.data[0];
  assert.equal(first.rank, 1);
  for (const key of ['userId', 'username', 'totalEquity', 'roiPct', 'hasUnpricedHoldings']) {
    assert.ok(key in first, `entry has ${key}`);
  }
});

test('GET /api/leaderboard?limit caps results; invalid limit -> 400', async () => {
  // Ensure at least two users exist so limit=1 is a real cap.
  await registerUser();
  await registerUser();
  const one = await apiJson('GET', '/api/leaderboard?limit=1');
  assert.equal(one.status, 200);
  assert.equal(one.body.data.length, 1);
  assert.equal(one.body.data[0].rank, 1);

  assert.equal((await apiJson('GET', '/api/leaderboard?limit=0')).status, 400);
  assert.equal((await apiJson('GET', '/api/leaderboard?limit=abc')).status, 400);
  assert.equal((await apiJson('GET', '/api/leaderboard?limit=999')).status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GET /api/leaderboard` returns 404 (route not mounted).

- [ ] **Step 3: Implement the controller**

Create `backend/src/controllers/leaderboard.controller.js`:

```js
const leaderboardService = require('../services/leaderboard.service');
const catchAsync = require('../utils/catchAsync');

const leaderboardController = {
  // GET /api/leaderboard?limit=  — users ranked by total equity.
  getLeaderboard: catchAsync(async (req, res) => {
    const entries = await leaderboardService.getLeaderboard({ limit: req.query.limit });
    res.status(200).json({ status: 'success', results: entries.length, data: entries });
  }),
};

module.exports = leaderboardController;
```

- [ ] **Step 4: Implement the route**

Create `backend/src/routes/leaderboard.routes.js`:

```js
const express = require('express');
const leaderboardController = require('../controllers/leaderboard.controller');

const router = express.Router();

router.get('/', leaderboardController.getLeaderboard);

module.exports = router;
```

- [ ] **Step 5: Mount the router**

In `backend/src/routes/index.js`, add the require and mount (mirroring the existing lines):

```js
const leaderboardRoutes = require('./leaderboard.routes');
// ...
router.use('/leaderboard', leaderboardRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run db:reset && npm test`
Expected: PASS — endpoint returns ranked entries; `?limit=1` caps to one; invalid limits 400.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/leaderboard.controller.js backend/src/routes/leaderboard.routes.js backend/src/routes/index.js backend/tests/leaderboard.test.js
git commit -m "feat(step8): GET /api/leaderboard endpoint"
```

---

### Task 4: Docs — TODO + MEMORY

**Files:**
- Modify: `TODO.md`, `MEMORY.md`

- [ ] **Step 1: Mark Step 8 done in `TODO.md`**

In `TODO.md`, replace the Step 8 block:

```markdown
## ✅ Step 8 — Leaderboard & ranking
- [x] `GET /api/leaderboard?limit=` ranked by total equity (= ROI order; $100k start)
- [x] Single aggregation query (users ⋈ wallets ⋈ positions ⋈ market_prices), indexed joins
- [x] Entries: rank, userId, username, totalEquity, roiPct, hasUnpricedHoldings
- [x] Tests: ordering, ROI, unpriced flag, limit cap, validation
```

Also update the `_Last updated:_` line near the top to `2026-07-02 (Step 8 complete)`.

- [ ] **Step 2: Update `MEMORY.md`**

In `MEMORY.md`, add this row to the Route table (after the market/users rows):

```markdown
| `GET /api/leaderboard` | leaderboard.routes.js | `leaderboardController.getLeaderboard` | `leaderboardService.getLeaderboard` |
```

And add this section after the "Limit orders (Step 7)" section:

```markdown
## Leaderboard (Step 8)
`GET /api/leaderboard?limit=` (default 50, cap 200) ranks all users by total equity
via one aggregation query in `leaderboard.repository.findRankedByEquity`
(users ⋈ wallets ⋈ positions ⋈ market_prices; unpriced holdings excluded from the
SUM, flagged by `has_unpriced`; ordered equity DESC, then created_at/id).
`leaderboard.service.getLeaderboard` validates `limit`, then derives `totalEquity` and
`roiPct` (vs the $100k start) at 4 dp and assigns 1-based `rank`. Equity order equals
ROI order because every account starts at $100k with no deposits.
```

Also update the `routes/index.js` comment note in MEMORY if present (the mounts line) to include `/leaderboard`.

- [ ] **Step 3: Commit**

```bash
git add TODO.md MEMORY.md
git commit -m "docs(step8): mark Step 8 complete in TODO/MEMORY"
```

---

## Self-Review

**1. Spec coverage:**
- `GET /api/leaderboard?limit=` top-N (default 50, cap 200) → Tasks 2, 3. ✓
- Rank by equity ≡ ROI; single aggregation query, indexed joins → Task 1. ✓
- Entry fields (rank, userId, username, totalEquity, roiPct, hasUnpricedHoldings) → Task 2. ✓
- Unpriced excluded from equity + flagged → Tasks 1 (SQL) & 2 (flag passthrough); tested Tasks 1–2. ✓
- Deterministic tie-break (created_at, id) → Task 1. ✓
- `limit` validation → 400 → Task 2. ✓
- Cash-only user ROI 0, winner ranks above, loser below → Task 2. ✓
- Global-aware tests (relative order, restore prices) → Tasks 1–3. ✓
- Mount `/leaderboard` → Task 3. Docs → Task 4. ✓

**2. Placeholder scan:** No TBD/"handle edge cases"/"similar to". Every code step shows full code. ✓

**3. Type consistency:** `findRankedByEquity(limit, client)` returns rows `{ id, username, created_at, balance, holdings_value, has_unpriced }` — consumed identically in Task 2 (`row.id`, `row.balance`, `row.holdings_value`, `row.has_unpriced`). Service returns `{ rank, userId, username, totalEquity, roiPct, hasUnpricedHoldings }` — asserted the same in Task 2 and Task 3. Controller/route/mount names (`getLeaderboard`, `/leaderboard`) consistent across Task 3. ✓

---

## Notes / things only the user can do

- No live/manual step required — the endpoint is a pure read fully covered by the DB tests. Optionally `curl http://localhost:5000/api/leaderboard` against a running server to eyeball the shape.
