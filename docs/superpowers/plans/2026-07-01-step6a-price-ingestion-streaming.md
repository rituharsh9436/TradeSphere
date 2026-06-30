# Step 6a — Backend Price Ingestion & Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live price pipeline — ticks (Finnhub WebSocket or a simulated fallback) flow into `market_prices` (latest) + a new `price_history` (ticks) table and are pushed to browser clients over a WebSocket, with candlestick OHLC aggregated on-read.

**Architecture:** A `marketdata/` subsystem produces a uniform tick stream `{ symbol, price, ts }` from either Finnhub or a simulator (selected by API-key presence + US market hours). An ingestion worker fans each tick out to two repositories and a WebSocket broadcaster. A REST endpoint aggregates `price_history` into OHLC candles on demand. Everything downstream is agnostic to where ticks originate, which keeps it testable offline.

**Tech Stack:** Node.js (CommonJS), Express 5, PostgreSQL via `pg`, `decimal.js`, `ws` (new), Node built-in test runner.

## Global Constraints

- Language: CommonJS (`require`/`module.exports`); `"type": "commonjs"`. No ESM.
- Money/price values are strings at **4 dp** via `decimal.js` (matches `DECIMAL(15,4)`).
- Layering: `routes → controllers → services → repositories → DB`. Each layer depends only on the one beneath. No business logic in controllers.
- Every repository method takes an optional trailing `client = pool` param.
- Operational errors use `AppError(message, statusCode)`; controllers wrap handlers in `catchAsync`. The central error handler maps PG codes (`23505→409`, `23514`/`23502→400`, `22P02→400`).
- Tests: Node built-in runner, `node --test --test-concurrency=1 "tests/**/*.test.js"`. DB-touching tests assume schema initialized via `npm run db:reset` and the seed prices AAPL=195, MSFT=430, TSLA=250. Tests must be order-independent (restore any seed data they mutate; isolate by unique time windows / symbols).
- Defaults: simulator tick = **2000 ms**; default candle bucket = **15 s**; history/DB-write throttle = **1000 ms/symbol**.
- Tick contract (every source emits, every consumer reads): `{ symbol: string, price: string /*4dp*/, ts: string /*ISO-8601*/ }`.
- Run all commands from `backend/` (where `package.json` lives) unless noted.

---

## File Structure

**Create:**
- `backend/src/repositories/priceHistory.repository.js` — append tick; OHLC aggregation query.
- `backend/src/repositories/marketPrice.repository.js` — upsert latest; read latest (all / by symbol).
- `backend/src/marketdata/marketHours.js` — `isUsMarketOpen(date)`.
- `backend/src/marketdata/simulatedTickSource.js` — random-walk tick source.
- `backend/src/marketdata/finnhubTickSource.js` — Finnhub WS tick source + message parsing.
- `backend/src/marketdata/tickSource.js` — selector/factory (live vs simulator).
- `backend/src/marketdata/marketSocket.js` — our browser-facing WS server.
- `backend/src/marketdata/ingestionWorker.js` — tick → repos + broadcast, throttled.
- `backend/src/marketdata/runtime.js` — wires source + worker + socket; start/stop.
- `backend/src/services/market.service.js` — candle/price reads + validation.
- `backend/src/controllers/market.controller.js` — HTTP adapters.
- `backend/src/routes/market.routes.js` — `/market` routes.
- `backend/.env.example` — documented env vars.
- Tests: `backend/tests/marketdata.unit.test.js` (no DB), `backend/tests/market.test.js` (DB + HTTP + WS).

**Modify:**
- `backend/src/scripts/init-db.js` — add `price_history` table + index.
- `backend/src/repositories/asset.repository.js` — add `findAllActive`.
- `backend/src/routes/index.js` — mount `/market`.
- `backend/src/server.js` — http.Server + attach socket + start/stop runtime.
- `backend/package.json` — add `ws` dependency.
- `TODO.md`, `MEMORY.md` — reflect Step 6a.

---

### Task 1: `price_history` schema

**Files:**
- Modify: `backend/src/scripts/init-db.js` (schema string + new comment block)
- Test: `backend/tests/market.test.js` (new file — first test only)

**Interfaces:**
- Produces: table `price_history(id uuid pk, asset_id uuid fk→assets, price decimal(15,4) >=0, ts timestamptz)` and index `idx_price_history_asset_ts(asset_id, ts)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/market.test.js`:

```js
'use strict';

// Step 6a — price ingestion & streaming. Boots the app in-process and exercises
// the schema, repositories, candle aggregation, REST endpoints and WS broadcast.
// Assumes schema initialized via `npm run db:reset` (seed AAPL=195, MSFT=430,
// TSLA=250). Isolated by unique time windows so it is order-independent.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');

after(async () => {
  await pool.end();
});

test('price_history table exists with expected columns', async () => {
  const { rows } = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'price_history'
     ORDER BY column_name`
  );
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.ok(cols.id, 'id column present');
  assert.ok(cols.asset_id, 'asset_id column present');
  assert.equal(cols.price, 'numeric');
  assert.match(cols.ts, /timestamp/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `price_history` returns no columns, `cols.id` assertion fails.

- [ ] **Step 3: Add the table to the schema**

In `backend/src/scripts/init-db.js`, inside the `schemaQuery` template string, immediately after the `market_prices` table block (the `-- 7.` block ending at its `);`) and before the `Indexes` comment block, insert:

```sql
    -- 8. Price History (raw ticks) — append-only source for candlestick
    --    aggregation. market_prices keeps only the latest; this keeps every tick.
    CREATE TABLE IF NOT EXISTS price_history (
        asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
        price DECIMAL(15, 4) NOT NULL CHECK (price >= 0),
        ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
    );
```

Then add this line into the existing `Indexes` block (after the `idx_positions_user_id` line):

```sql
    CREATE INDEX IF NOT EXISTS idx_price_history_asset_ts ON price_history(asset_id, ts);
```

- [ ] **Step 4: Re-initialize the DB and run the test**

Run: `npm run db:reset && npm test`
Expected: PASS — `price_history` columns present.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/init-db.js backend/tests/market.test.js
git commit -m "feat(step6a): add price_history table for candlestick ticks"
```

---

### Task 2: `priceHistory.repository` — append + OHLC aggregation

**Files:**
- Create: `backend/src/repositories/priceHistory.repository.js`
- Test: `backend/tests/market.test.js` (append + aggregate tests)

**Interfaces:**
- Consumes: `pool` from `config/database`; `assets`/`price_history` tables.
- Produces:
  - `append(assetId, price, ts, client = pool) → Promise<void>`
  - `aggregateCandles({ symbol, intervalSec, from, to }, client = pool) → Promise<Array<{ time: string /*ISO*/, open: string, high: string, low: string, close: string }>>` — buckets ordered ascending; `open`/`close` = first/last tick by `ts` in the bucket; `high`/`low` = max/min.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/market.test.js`:

```js
const priceHistoryRepository = require('../src/repositories/priceHistory.repository');

// A far-past window unique to this suite so ticks never collide with live data.
const W_FROM = new Date('2000-01-01T00:00:00.000Z');
const W_TO = new Date('2000-01-01T00:10:00.000Z');

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}

test('priceHistory: append + aggregateCandles builds OHLC buckets', async () => {
  const aaplId = await assetIdOf('AAPL');
  // Clean the window first so reruns are deterministic.
  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);

  // Two 60s buckets. Bucket A (00:00): 100,105,102 -> O100 H105 L100 C102.
  // Bucket B (00:01): 103,99       -> O103 H103 L99  C99.
  const ticks = [
    ['2000-01-01T00:00:10.000Z', '100'],
    ['2000-01-01T00:00:20.000Z', '105'],
    ['2000-01-01T00:00:50.000Z', '102'],
    ['2000-01-01T00:01:05.000Z', '103'],
    ['2000-01-01T00:01:40.000Z', '99'],
  ];
  for (const [ts, price] of ticks) {
    await priceHistoryRepository.append(aaplId, price, new Date(ts));
  }

  const candles = await priceHistoryRepository.aggregateCandles({
    symbol: 'AAPL', intervalSec: 60, from: W_FROM, to: W_TO,
  });

  assert.equal(candles.length, 2);
  assert.deepEqual(
    { o: candles[0].open, h: candles[0].high, l: candles[0].low, c: candles[0].close },
    { o: '100.0000', h: '105.0000', l: '100.0000', c: '102.0000' }
  );
  assert.deepEqual(
    { o: candles[1].open, h: candles[1].high, l: candles[1].low, c: candles[1].close },
    { o: '103.0000', h: '103.0000', l: '99.0000', c: '99.0000' }
  );
  assert.equal(typeof candles[0].time, 'string');

  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/repositories/priceHistory.repository'`.

- [ ] **Step 3: Implement the repository**

Create `backend/src/repositories/priceHistory.repository.js`:

```js
const pool = require('../config/database');

// Raw tick storage + on-read candlestick aggregation. market_prices holds only
// the latest price; this table keeps every tick so we can build OHLC candles for
// any interval after the fact.
const priceHistoryRepository = {
  async append(assetId, price, ts, client = pool) {
    await client.query(
      `INSERT INTO price_history (asset_id, price, ts) VALUES ($1, $2, $3)`,
      [assetId, price, ts]
    );
  },

  // Aggregate ticks into OHLC buckets of `intervalSec` seconds over [from, to).
  // open/close are the first/last tick by ts within the bucket; high/low the
  // max/min. Buckets are returned ascending; empty buckets are omitted.
  async aggregateCandles({ symbol, intervalSec, from, to }, client = pool) {
    const { rows } = await client.query(
      `SELECT to_timestamp(floor(extract(epoch from ph.ts) / $2) * $2) AS bucket,
              (array_agg(ph.price ORDER BY ph.ts ASC))[1]  AS open,
              max(ph.price)                                 AS high,
              min(ph.price)                                 AS low,
              (array_agg(ph.price ORDER BY ph.ts DESC))[1]  AS close
       FROM price_history ph
       JOIN assets a ON a.id = ph.asset_id
       WHERE a.symbol = $1 AND ph.ts >= $3 AND ph.ts < $4
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [symbol, intervalSec, from, to]
    );
    return rows.map((r) => ({
      time: r.bucket.toISOString(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
  },
};

module.exports = priceHistoryRepository;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both buckets match expected OHLC.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repositories/priceHistory.repository.js backend/tests/market.test.js
git commit -m "feat(step6a): priceHistory repo with append + OHLC aggregation"
```

---

### Task 3: `marketPrice.repository` + `asset.findAllActive`

**Files:**
- Create: `backend/src/repositories/marketPrice.repository.js`
- Modify: `backend/src/repositories/asset.repository.js`
- Test: `backend/tests/market.test.js`

**Interfaces:**
- Produces:
  - `marketPriceRepository.upsertLatest(assetId, price, client = pool) → Promise<void>`
  - `marketPriceRepository.findAll(client = pool) → Promise<Array<{ symbol, price, updatedAt }>>`
  - `marketPriceRepository.findBySymbol(symbol, client = pool) → Promise<{ symbol, price, updatedAt } | null>`
  - `assetRepository.findAllActive(client = pool) → Promise<Array<{ id, symbol, name, asset_class, is_active }>>`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/market.test.js`:

```js
const marketPriceRepository = require('../src/repositories/marketPrice.repository');
const assetRepository = require('../src/repositories/asset.repository');

test('marketPrice: upsertLatest + reads, asset.findAllActive', async () => {
  const msftId = await assetIdOf('MSFT');

  await marketPriceRepository.upsertLatest(msftId, '441.2500');
  const one = await marketPriceRepository.findBySymbol('MSFT');
  assert.equal(one.symbol, 'MSFT');
  assert.equal(one.price, '441.2500');

  const all = await marketPriceRepository.findAll();
  assert.ok(all.find((p) => p.symbol === 'MSFT' && p.price === '441.2500'));

  assert.equal(await marketPriceRepository.findBySymbol('NOSUCH'), null);

  const active = await assetRepository.findAllActive();
  assert.ok(active.find((a) => a.symbol === 'MSFT' && a.id === msftId));

  // Restore seed price for order-independence.
  await marketPriceRepository.upsertLatest(msftId, '430.0000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/repositories/marketPrice.repository'`.

- [ ] **Step 3: Implement marketPrice repo**

Create `backend/src/repositories/marketPrice.repository.js`:

```js
const pool = require('../config/database');

// Latest-price store (one row per asset). The ingestion worker upserts here on
// every (throttled) tick; portfolio valuation and the order engine read it.
const marketPriceRepository = {
  async upsertLatest(assetId, price, client = pool) {
    await client.query(
      `INSERT INTO market_prices (asset_id, price)
       VALUES ($1, $2)
       ON CONFLICT (asset_id)
       DO UPDATE SET price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP`,
      [assetId, price]
    );
  },

  async findAll(client = pool) {
    const { rows } = await client.query(
      `SELECT a.symbol, m.price, m.updated_at AS "updatedAt"
       FROM market_prices m
       JOIN assets a ON a.id = m.asset_id
       ORDER BY a.symbol`
    );
    return rows;
  },

  async findBySymbol(symbol, client = pool) {
    const { rows } = await client.query(
      `SELECT a.symbol, m.price, m.updated_at AS "updatedAt"
       FROM market_prices m
       JOIN assets a ON a.id = m.asset_id
       WHERE a.symbol = $1`,
      [symbol]
    );
    return rows[0] || null;
  },
};

module.exports = marketPriceRepository;
```

- [ ] **Step 4: Add `findAllActive` to asset repo**

In `backend/src/repositories/asset.repository.js`, add this method inside the `assetRepository` object (after `getPrice`, keeping the trailing comma style):

```js
  // Active, tradable assets — used to seed the tick simulator and to choose the
  // Finnhub symbols to subscribe to.
  async findAllActive(client = pool) {
    const { rows } = await client.query(
      `SELECT id, symbol, name, asset_class, is_active
       FROM assets WHERE is_active = TRUE ORDER BY symbol`
    );
    return rows;
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/repositories/marketPrice.repository.js backend/src/repositories/asset.repository.js backend/tests/market.test.js
git commit -m "feat(step6a): marketPrice repo + asset.findAllActive"
```

---

### Task 4: `simulatedTickSource`

**Files:**
- Create: `backend/src/marketdata/simulatedTickSource.js`
- Test: `backend/tests/marketdata.unit.test.js` (new file — no DB)

**Interfaces:**
- Produces: `createSimulatedTickSource({ seeds, intervalMs = 2000, volatility = 0.005, rng = Math.random, now = () => new Date() }) → { start(), stop(), onTick(cb), tickOnce() }`
  - `seeds`: `Array<{ symbol, price }>` (price string/number).
  - `onTick(cb)`: `cb` receives one tick `{ symbol, price /*4dp string*/, ts /*ISO*/ }`.
  - `tickOnce()`: emits exactly one tick per seed (exposed for deterministic tests).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/marketdata.unit.test.js`:

```js
'use strict';

// Pure unit tests for the marketdata subsystem — no DB, no network. Sources and
// the worker take injected deps so behavior is deterministic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const createSimulatedTickSource = require('../src/marketdata/simulatedTickSource');

test('simulatedTickSource: tickOnce emits one 4dp tick per seed via rng', () => {
  const fixedNow = new Date('2020-05-01T12:00:00.000Z');
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '100' }, { symbol: 'MSFT', price: '200' }],
    volatility: 0.01,
    rng: () => 1, // delta = (1*2 - 1) * 0.01 = +0.01 -> +1%
    now: () => fixedNow,
  });

  const ticks = [];
  src.onTick((t) => ticks.push(t));
  src.tickOnce();

  assert.equal(ticks.length, 2);
  const aapl = ticks.find((t) => t.symbol === 'AAPL');
  assert.equal(aapl.price, '101.0000'); // 100 * 1.01
  assert.equal(aapl.ts, fixedNow.toISOString());
  const msft = ticks.find((t) => t.symbol === 'MSFT');
  assert.equal(msft.price, '202.0000'); // 200 * 1.01
});

test('simulatedTickSource: price never goes negative', () => {
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '0.01' }],
    volatility: 1, // huge swings
    rng: () => 0, // delta = (0*2 - 1) * 1 = -1 -> -100%
  });
  let last;
  src.onTick((t) => { last = t; });
  src.tickOnce();
  assert.equal(last.price, '0.0000');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/simulatedTickSource'`.

- [ ] **Step 3: Implement the simulator**

Create `backend/src/marketdata/simulatedTickSource.js`:

```js
const Decimal = require('decimal.js');

// A self-contained random-walk price feed. Used when no Finnhub key is set, when
// the US market is closed, and in tests (inject `rng`/`now` for determinism).
// Emits the same tick shape as the live source: { symbol, price, ts }.
function createSimulatedTickSource({
  seeds,
  intervalMs = 2000,
  volatility = 0.005,
  rng = Math.random,
  now = () => new Date(),
}) {
  const prices = new Map(seeds.map((s) => [s.symbol, new Decimal(s.price)]));
  const listeners = [];
  let timer = null;

  function emit(tick) {
    for (const cb of listeners) cb(tick);
  }

  function tickOnce() {
    for (const [symbol, price] of prices) {
      const delta = (rng() * 2 - 1) * volatility; // ±volatility
      let next = price.times(1 + delta);
      if (next.lt(0)) next = new Decimal(0);
      prices.set(symbol, next);
      emit({ symbol, price: next.toFixed(4), ts: now().toISOString() });
    }
  }

  return {
    onTick(cb) {
      listeners.push(cb);
    },
    start() {
      if (timer) return;
      timer = setInterval(tickOnce, intervalMs);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tickOnce,
  };
}

module.exports = createSimulatedTickSource;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both simulator tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/marketdata/simulatedTickSource.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step6a): simulated random-walk tick source"
```

---

### Task 5: `finnhubTickSource` (+ install `ws`)

**Files:**
- Modify: `backend/package.json` (add `ws`)
- Create: `backend/src/marketdata/finnhubTickSource.js`
- Test: `backend/tests/marketdata.unit.test.js`

**Interfaces:**
- Produces: `createFinnhubTickSource({ apiKey, symbols, WebSocketImpl = require('ws'), now = () => new Date(), reconnectMs = 3000 }) → { start(), stop(), onTick(cb), parseTradeMessage(raw) }`
  - `parseTradeMessage(raw)`: parses a raw Finnhub frame string into `Array<tick>` (empty array for non-`trade` frames). Exposed for testing.
  - `onTick(cb)`: receives one tick at a time.

- [ ] **Step 1: Install `ws`**

Run: `npm install ws`
Expected: `ws` appears under `dependencies` in `backend/package.json`; `node -e "require('ws')"` exits 0.

- [ ] **Step 2: Write the failing test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
const createFinnhubTickSource = require('../src/marketdata/finnhubTickSource');

test('finnhubTickSource: parseTradeMessage maps trade frames to 4dp ticks', () => {
  const src = createFinnhubTickSource({ apiKey: 'k', symbols: ['AAPL'] });

  const frame = JSON.stringify({
    type: 'trade',
    data: [
      { s: 'AAPL', p: 195.123, t: 1577836800000 }, // 2020-01-01T00:00:00Z
      { s: 'MSFT', p: 430, t: 1577836800000 },
    ],
  });
  const ticks = src.parseTradeMessage(frame);
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks[0], {
    symbol: 'AAPL',
    price: '195.1230',
    ts: new Date(1577836800000).toISOString(),
  });

  // Non-trade frames (e.g. ping) yield no ticks.
  assert.deepEqual(src.parseTradeMessage(JSON.stringify({ type: 'ping' })), []);
  assert.deepEqual(src.parseTradeMessage('not json'), []);
});

test('finnhubTickSource: subscribes to all symbols on open', () => {
  const sent = [];
  // Fake ws: captures send() payloads and exposes open hook.
  class FakeWS {
    constructor() { this.handlers = {}; FakeWS.last = this; }
    on(evt, cb) { this.handlers[evt] = cb; return this; }
    send(msg) { sent.push(msg); }
    close() { this.closed = true; }
  }
  const src = createFinnhubTickSource({
    apiKey: 'k', symbols: ['AAPL', 'MSFT'], WebSocketImpl: FakeWS,
  });
  src.start();
  FakeWS.last.handlers.open();

  assert.deepEqual(sent, [
    JSON.stringify({ type: 'subscribe', symbol: 'AAPL' }),
    JSON.stringify({ type: 'subscribe', symbol: 'MSFT' }),
  ]);
  src.stop();
  assert.equal(FakeWS.last.closed, true);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/finnhubTickSource'`.

- [ ] **Step 4: Implement the Finnhub source**

Create `backend/src/marketdata/finnhubTickSource.js`:

```js
const Decimal = require('decimal.js');

// Live tick source backed by Finnhub's real-time trades WebSocket
// (wss://ws.finnhub.io). Subscribes to each symbol on open and emits ticks for
// every trade. Reconnects with a fixed delay; only streams during US market
// hours (the selector decides when to use this source). `WebSocketImpl` is
// injectable so the parsing/subscribe logic is testable without a network.
function createFinnhubTickSource({
  apiKey,
  symbols,
  WebSocketImpl = require('ws'),
  now = () => new Date(),
  reconnectMs = 3000,
}) {
  const listeners = [];
  let ws = null;
  let stopped = false;
  let retryTimer = null;

  function emit(tick) {
    for (const cb of listeners) cb(tick);
  }

  function parseTradeMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!msg || msg.type !== 'trade' || !Array.isArray(msg.data)) return [];
    return msg.data.map((d) => ({
      symbol: d.s,
      price: new Decimal(d.p).toFixed(4),
      ts: new Date(d.t).toISOString(),
    }));
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocketImpl(`wss://ws.finnhub.io?token=${apiKey}`);

    ws.on('open', () => {
      for (const symbol of symbols) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      }
    });
    ws.on('message', (raw) => {
      for (const tick of parseTradeMessage(raw.toString())) emit(tick);
    });
    ws.on('error', (err) => {
      console.error('Finnhub WS error:', err.message);
    });
    ws.on('close', () => {
      if (stopped) return;
      retryTimer = setTimeout(connect, reconnectMs);
      if (retryTimer.unref) retryTimer.unref();
    });
  }

  return {
    onTick(cb) {
      listeners.push(cb);
    },
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
      ws = null;
    },
    parseTradeMessage,
  };
}

module.exports = createFinnhubTickSource;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — parse + subscribe tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/marketdata/finnhubTickSource.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step6a): Finnhub trades WebSocket tick source"
```

---

### Task 6: market-hours util + tick-source selector

**Files:**
- Create: `backend/src/marketdata/marketHours.js`
- Create: `backend/src/marketdata/tickSource.js`
- Test: `backend/tests/marketdata.unit.test.js`

**Interfaces:**
- Produces:
  - `isUsMarketOpen(date) → boolean` — true Mon–Fri, 09:30–16:00 America/New_York.
  - `createTickSource({ apiKey, isMarketOpen, makeFinnhub, makeSimulated }) → { source, mode }` where `mode` is `'finnhub'` or `'simulated'`, and `source` is the chosen tick source object. Uses Finnhub only when `apiKey` is truthy **and** `isMarketOpen` is true; otherwise simulator.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
const { isUsMarketOpen } = require('../src/marketdata/marketHours');
const createTickSource = require('../src/marketdata/tickSource');

test('isUsMarketOpen: weekday midday open, weekend + off-hours closed', () => {
  // 2020-01-02 (Thu) 14:30 UTC = 09:30 ET (EST) -> open.
  assert.equal(isUsMarketOpen(new Date('2020-01-02T14:30:00Z')), true);
  // 2020-01-02 (Thu) 22:00 UTC = 17:00 ET -> closed.
  assert.equal(isUsMarketOpen(new Date('2020-01-02T22:00:00Z')), false);
  // 2020-01-04 is a Saturday -> closed.
  assert.equal(isUsMarketOpen(new Date('2020-01-04T15:00:00Z')), false);
});

test('createTickSource: picks finnhub only with key + open market', () => {
  const make = (tag) => () => ({ tag });
  const open = createTickSource({
    apiKey: 'k', isMarketOpen: true, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(open.mode, 'finnhub');
  assert.equal(open.source.tag, 'fh');

  const closed = createTickSource({
    apiKey: 'k', isMarketOpen: false, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(closed.mode, 'simulated');

  const noKey = createTickSource({
    apiKey: '', isMarketOpen: true, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(noKey.mode, 'simulated');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/marketHours'`.

- [ ] **Step 3: Implement market-hours util**

Create `backend/src/marketdata/marketHours.js`:

```js
// US equity regular session: Mon–Fri, 09:30–16:00 America/New_York. Uses Intl to
// resolve ET wall-clock (handles EST/EDT) without a date library. Holidays are
// not modeled — out of scope for Step 6a (the simulator covers any dead feed).
const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function isUsMarketOpen(date) {
  const parts = Object.fromEntries(ET.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = parts.weekday; // 'Mon'..'Sun'
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

module.exports = { isUsMarketOpen };
```

- [ ] **Step 4: Implement the selector**

Create `backend/src/marketdata/tickSource.js`:

```js
// Chooses the active tick source: the live Finnhub feed only when we have an API
// key AND the US market is open; otherwise the simulator. Factories are injected
// so the decision is unit-testable; runtime.js supplies the real ones.
function createTickSource({ apiKey, isMarketOpen, makeFinnhub, makeSimulated }) {
  if (apiKey && isMarketOpen) {
    return { source: makeFinnhub(), mode: 'finnhub' };
  }
  return { source: makeSimulated(), mode: 'simulated' };
}

module.exports = createTickSource;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — market-hours + selector tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/marketdata/marketHours.js backend/src/marketdata/tickSource.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step6a): market-hours check + tick-source selector"
```

---

### Task 7: `marketSocket` — browser-facing WS server

**Files:**
- Create: `backend/src/marketdata/marketSocket.js`
- Test: `backend/tests/market.test.js` (WS broadcast over a real http server)

**Interfaces:**
- Produces: `createMarketSocket() → { attach(httpServer, path = '/ws/market'), broadcast(obj), close() }`
  - `attach`: mounts a `ws` server on the given HTTP server + path.
  - `broadcast(obj)`: JSON-stringifies `obj` and sends to every open client.
  - `close()`: closes the WS server.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/market.test.js`:

```js
const http = require('node:http');
const WebSocket = require('ws');
const createMarketSocket = require('../src/marketdata/marketSocket');

test('marketSocket: broadcast reaches a connected client', async () => {
  const server = http.createServer();
  const socket = createMarketSocket();
  socket.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/market`);
  const got = new Promise((resolve) => client.on('message', (m) => resolve(JSON.parse(m))));
  await new Promise((r) => client.on('open', r));

  socket.broadcast({ type: 'tick', symbol: 'AAPL', price: '195.0000' });
  const msg = await got;
  assert.deepEqual(msg, { type: 'tick', symbol: 'AAPL', price: '195.0000' });

  client.close();
  socket.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/marketSocket'`.

- [ ] **Step 3: Implement the socket**

Create `backend/src/marketdata/marketSocket.js`:

```js
const { WebSocketServer, WebSocket } = require('ws');

// Our browser-facing WebSocket. The ingestion worker calls broadcast() on every
// tick; connected chart clients receive { type: 'tick', symbol, price, ts }.
// Subscription filtering is intentionally minimal for Step 6a (clients get all
// symbols); a per-symbol filter can be added when the chart needs it.
function createMarketSocket() {
  let wss = null;

  return {
    attach(httpServer, path = '/ws/market') {
      wss = new WebSocketServer({ server: httpServer, path });
    },
    broadcast(obj) {
      if (!wss) return;
      const payload = JSON.stringify(obj);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
    },
    close() {
      if (wss) wss.close();
      wss = null;
    },
  };
}

module.exports = createMarketSocket;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — client receives the broadcast.

- [ ] **Step 5: Commit**

```bash
git add backend/src/marketdata/marketSocket.js backend/tests/market.test.js
git commit -m "feat(step6a): browser-facing market WebSocket"
```

---

### Task 8: `ingestionWorker` — tick fan-out with throttle

**Files:**
- Create: `backend/src/marketdata/ingestionWorker.js`
- Test: `backend/tests/marketdata.unit.test.js` (fakes, no DB)

**Interfaces:**
- Consumes: a tick source (`onTick`/`start`/`stop`), `marketPriceRepository`, `priceHistoryRepository`, `marketSocket`.
- Produces: `createIngestionWorker({ tickSource, marketPriceRepository, priceHistoryRepository, marketSocket, assetIdBySymbol, throttleMs = 1000, now = () => Date.now() }) → { start(), stop() }`
  - On each tick: always `broadcast({ type: 'tick', ...tick })`; DB writes (`upsertLatest` + `append`) are **throttled to once per `throttleMs` per symbol**. Unknown symbols (not in `assetIdBySymbol`) are skipped. Repo errors are logged and swallowed.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
const createIngestionWorker = require('../src/marketdata/ingestionWorker');

function fakeSource() {
  let cb = null;
  return {
    onTick(fn) { cb = fn; },
    start() {},
    stop() {},
    push(tick) { cb(tick); },
  };
}

test('ingestionWorker: broadcasts every tick, throttles DB writes per symbol', () => {
  const upserts = [];
  const appends = [];
  const broadcasts = [];
  const src = fakeSource();
  let clock = 1000;

  const worker = createIngestionWorker({
    tickSource: src,
    marketPriceRepository: { upsertLatest: async (id, p) => { upserts.push([id, p]); } },
    priceHistoryRepository: { append: async (id, p) => { appends.push([id, p]); } },
    marketSocket: { broadcast: (m) => broadcasts.push(m) },
    assetIdBySymbol: new Map([['AAPL', 'aapl-id']]),
    throttleMs: 1000,
    now: () => clock,
  });
  worker.start();

  src.push({ symbol: 'AAPL', price: '100.0000', ts: 't1' }); // clock 1000 -> writes
  src.push({ symbol: 'AAPL', price: '101.0000', ts: 't2' }); // clock 1000 -> throttled
  clock = 2000;
  src.push({ symbol: 'AAPL', price: '102.0000', ts: 't3' }); // clock 2000 -> writes
  src.push({ symbol: 'NOPE', price: '5.0000', ts: 't4' });   // unknown symbol -> skipped DB

  assert.equal(broadcasts.length, 4); // every tick broadcast
  assert.deepEqual(upserts, [['aapl-id', '100.0000'], ['aapl-id', '102.0000']]);
  assert.deepEqual(appends, [['aapl-id', '100.0000'], ['aapl-id', '102.0000']]);
  assert.deepEqual(broadcasts[0], { type: 'tick', symbol: 'AAPL', price: '100.0000', ts: 't1' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/ingestionWorker'`.

- [ ] **Step 3: Implement the worker**

Create `backend/src/marketdata/ingestionWorker.js`:

```js
// Subscribes to the active tick source and fans each tick out:
//   - broadcast to WS clients (every tick — keeps the chart smooth)
//   - upsert latest price + append to history (throttled per symbol so a busy
//     live feed can't flood the DB)
// DB errors are logged and swallowed so one bad write never kills the stream.
function createIngestionWorker({
  tickSource,
  marketPriceRepository,
  priceHistoryRepository,
  marketSocket,
  assetIdBySymbol,
  throttleMs = 1000,
  now = () => Date.now(),
}) {
  const lastWriteAt = new Map(); // symbol -> ms timestamp of last DB write

  async function persist(assetId, tick) {
    try {
      await marketPriceRepository.upsertLatest(assetId, tick.price);
      await priceHistoryRepository.append(assetId, tick.price, tick.ts);
    } catch (err) {
      console.error('Ingestion DB write failed:', err.message);
    }
  }

  function handleTick(tick) {
    marketSocket.broadcast({ type: 'tick', symbol: tick.symbol, price: tick.price, ts: tick.ts });

    const assetId = assetIdBySymbol.get(tick.symbol);
    if (!assetId) return; // not a tracked asset — nothing to persist

    const t = now();
    const last = lastWriteAt.get(tick.symbol);
    if (last !== undefined && t - last < throttleMs) return; // throttled
    lastWriteAt.set(tick.symbol, t);
    void persist(assetId, tick);
  }

  return {
    start() {
      tickSource.onTick(handleTick);
      tickSource.start();
    },
    stop() {
      tickSource.stop();
    },
  };
}

module.exports = createIngestionWorker;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — broadcast count 4, two throttled DB write pairs.

- [ ] **Step 5: Commit**

```bash
git add backend/src/marketdata/ingestionWorker.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step6a): ingestion worker with per-symbol DB throttle"
```

---

### Task 9: `market.service` — candle/price reads + validation

**Files:**
- Create: `backend/src/services/market.service.js`
- Test: `backend/tests/marketdata.unit.test.js` (validation, no DB) + `backend/tests/market.test.js` (aggregation through service)

**Interfaces:**
- Consumes: `assetRepository.findBySymbol`, `marketPriceRepository.findAll/findBySymbol`, `priceHistoryRepository.aggregateCandles`.
- Produces:
  - `getPrices() → Promise<Array<{ symbol, price, updatedAt }>>`
  - `getPriceBySymbol(symbol) → Promise<{ symbol, price, updatedAt }>` (404 if unknown)
  - `getCandles({ symbol, interval, from, to }) → Promise<{ symbol, intervalSec, candles }>`
    - Validation order (interval/range first so it is testable without DB):
      - `intervalSec = Number(interval ?? 15)`; must be a finite integer in `[1, 86400]` → else `AppError(400)`.
      - `to = to ? new Date(to) : new Date()`, `from = from ? new Date(from) : new Date(to - 24h)`; invalid dates or `from >= to` → `AppError(400)`; more than `MAX_BUCKETS = 5000` buckets in range → `AppError(400)`.
      - then `assetRepository.findBySymbol(symbol)`; missing → `AppError(404)`.

- [ ] **Step 1: Write the failing validation tests**

Append to `backend/tests/marketdata.unit.test.js`:

```js
const marketService = require('../src/services/market.service');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('market.service.getCandles: rejects bad interval and range before DB', async () => {
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '0' }), 400);
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: 'abc' }), 400);
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '99999999' }), 400);
  await rejectsWith(
    () => marketService.getCandles({
      symbol: 'AAPL', interval: '15',
      from: '2020-01-02T00:00:00Z', to: '2020-01-01T00:00:00Z', // from >= to
    }),
    400
  );
  // 1s buckets over a 24h default window = 86400 buckets > MAX_BUCKETS.
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '1' }), 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/services/market.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/market.service.js`:

```js
const AppError = require('../utils/AppError');
const assetRepository = require('../repositories/asset.repository');
const marketPriceRepository = require('../repositories/marketPrice.repository');
const priceHistoryRepository = require('../repositories/priceHistory.repository');

const DEFAULT_INTERVAL_SEC = 15;
const MAX_INTERVAL_SEC = 86400; // 1 day
const MAX_BUCKETS = 5000; // cap response size / query cost
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

const marketService = {
  async getPrices() {
    return marketPriceRepository.findAll();
  },

  async getPriceBySymbol(symbol) {
    const price = await marketPriceRepository.findBySymbol(symbol);
    if (!price) throw new AppError('Unknown symbol.', 404);
    return price;
  },

  // OHLC candles aggregated on-read from price_history. Interval/range are
  // validated before any DB access so the cheap rejections stay cheap.
  async getCandles({ symbol, interval, from, to }) {
    const intervalSec = Number(interval ?? DEFAULT_INTERVAL_SEC);
    if (!Number.isInteger(intervalSec) || intervalSec < 1 || intervalSec > MAX_INTERVAL_SEC) {
      throw new AppError('interval must be an integer between 1 and 86400 seconds.', 400);
    }

    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_WINDOW_MS);
    if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) {
      throw new AppError('from/to must be valid dates.', 400);
    }
    if (fromDate >= toDate) {
      throw new AppError('from must be earlier than to.', 400);
    }
    if ((toDate.getTime() - fromDate.getTime()) / 1000 / intervalSec > MAX_BUCKETS) {
      throw new AppError('Requested range is too large for this interval.', 400);
    }

    const asset = await assetRepository.findBySymbol(symbol);
    if (!asset) throw new AppError('Unknown symbol.', 404);

    const candles = await priceHistoryRepository.aggregateCandles({
      symbol, intervalSec, from: fromDate, to: toDate,
    });
    return { symbol, intervalSec, candles };
  },
};

module.exports = marketService;
```

- [ ] **Step 4: Run validation test to verify it passes**

Run: `npm test`
Expected: PASS — all four 400 rejections.

- [ ] **Step 5: Add an aggregation-through-service test**

Append to `backend/tests/market.test.js`:

```js
const marketService = require('../src/services/market.service');

test('market.service.getCandles: returns OHLC from stored ticks', async () => {
  const aaplId = await assetIdOf('AAPL');
  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
  for (const [ts, price] of [
    ['2000-01-01T00:00:10.000Z', '100'],
    ['2000-01-01T00:00:50.000Z', '108'],
  ]) {
    await priceHistoryRepository.append(aaplId, price, new Date(ts));
  }

  const out = await marketService.getCandles({
    symbol: 'AAPL', interval: '60',
    from: W_FROM.toISOString(), to: W_TO.toISOString(),
  });
  assert.equal(out.intervalSec, 60);
  assert.equal(out.candles.length, 1);
  assert.equal(out.candles[0].open, '100.0000');
  assert.equal(out.candles[0].close, '108.0000');

  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/market.service.js backend/tests/marketdata.unit.test.js backend/tests/market.test.js
git commit -m "feat(step6a): market service for prices + candle reads"
```

---

### Task 10: REST controller + routes + mount

**Files:**
- Create: `backend/src/controllers/market.controller.js`
- Create: `backend/src/routes/market.routes.js`
- Modify: `backend/src/routes/index.js`
- Test: `backend/tests/market.test.js` (HTTP via in-process app)

**Interfaces:**
- Consumes: `marketService`.
- Produces routes mounted at `/api/market`:
  - `GET /prices` → `{ status, results, data: [...] }`
  - `GET /prices/:symbol` → `{ status, data: {...} }`
  - `GET /candles?symbol=&interval=&from=&to=` → `{ status, data: { symbol, intervalSec, candles } }` (symbol required → 400 if missing).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/market.test.js`:

```js
const app = require('../src/app');

let httpServer;
let base;
before(async () => {
  httpServer = http.createServer(app);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${httpServer.address().port}`;
});
test('teardown market http server', { skip: false }, () => {}); // keep `before` scoped to file

async function apiGet(path) {
  const res = await fetch(base + path);
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

test('GET /api/market/prices returns seeded latest prices', async () => {
  const r = await apiGet('/api/market/prices');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.find((p) => p.symbol === 'AAPL'));
});

test('GET /api/market/prices/:symbol — known 200, unknown 404', async () => {
  assert.equal((await apiGet('/api/market/prices/AAPL')).status, 200);
  assert.equal((await apiGet('/api/market/prices/NOSUCH')).status, 404);
});

test('GET /api/market/candles — validation + missing symbol', async () => {
  assert.equal((await apiGet('/api/market/candles?interval=15')).status, 400); // no symbol
  assert.equal((await apiGet('/api/market/candles?symbol=AAPL&interval=0')).status, 400);
  assert.equal((await apiGet('/api/market/candles?symbol=NOSUCH&interval=15')).status, 404);
  const ok = await apiGet('/api/market/candles?symbol=AAPL&interval=60');
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.data.candles));
});
```

Add the matching teardown — extend the existing `after` at the top of the file to also close `httpServer`:

```js
// Replace the existing single-line after() from Task 1 with:
after(async () => {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await pool.end();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/market/prices` returns 404 (route not mounted), assertions fail.

- [ ] **Step 3: Implement controller**

Create `backend/src/controllers/market.controller.js`:

```js
const marketService = require('../services/market.service');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// Thin HTTP adapters over the market service.
const marketController = {
  getPrices: catchAsync(async (req, res) => {
    const prices = await marketService.getPrices();
    res.status(200).json({ status: 'success', results: prices.length, data: prices });
  }),

  getPrice: catchAsync(async (req, res) => {
    const price = await marketService.getPriceBySymbol(req.params.symbol);
    res.status(200).json({ status: 'success', data: price });
  }),

  getCandles: catchAsync(async (req, res) => {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) throw new AppError('symbol query parameter is required.', 400);
    const data = await marketService.getCandles({ symbol, interval, from, to });
    res.status(200).json({ status: 'success', data });
  }),
};

module.exports = marketController;
```

- [ ] **Step 4: Implement routes**

Create `backend/src/routes/market.routes.js`:

```js
const express = require('express');
const marketController = require('../controllers/market.controller');

const router = express.Router();

router.get('/prices', marketController.getPrices);
router.get('/prices/:symbol', marketController.getPrice);
router.get('/candles', marketController.getCandles);

module.exports = router;
```

- [ ] **Step 5: Mount the router**

In `backend/src/routes/index.js`, add the require and mount (mirroring the existing user/order lines):

```js
const marketRoutes = require('./market.routes');
// ...
router.use('/market', marketRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS — prices/candles endpoints behave as asserted.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/market.controller.js backend/src/routes/market.routes.js backend/src/routes/index.js backend/tests/market.test.js
git commit -m "feat(step6a): market REST endpoints (prices, candles)"
```

---

### Task 11: runtime wiring + server lifecycle

**Files:**
- Create: `backend/src/marketdata/runtime.js`
- Modify: `backend/src/server.js`
- Test: `backend/tests/marketdata.unit.test.js` (runtime wiring with fakes)

**Interfaces:**
- Produces:
  - `buildAssetIdBySymbol(assets) → Map<symbol, id>` (pure helper, exported for test).
  - `createMarketRuntime({ assets, latestPrices, apiKey, isMarketOpen, marketSocket, deps }) → { start(), stop(), mode }` — selects the source, constructs the ingestion worker, and exposes start/stop. `deps` injects `createTickSource`, `createSimulatedTickSource`, `createFinnhubTickSource`, `createIngestionWorker`, repos (defaults wired to the real modules).
- Consumes (in `server.js`): `assetRepository.findAllActive`, `marketPriceRepository.findAll`, `createMarketSocket`, `createMarketRuntime`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/marketdata.unit.test.js`:

```js
const { buildAssetIdBySymbol, createMarketRuntime } = require('../src/marketdata/runtime');

test('buildAssetIdBySymbol maps symbol -> id', () => {
  const map = buildAssetIdBySymbol([{ id: 'a1', symbol: 'AAPL' }, { id: 'm1', symbol: 'MSFT' }]);
  assert.equal(map.get('AAPL'), 'a1');
  assert.equal(map.get('MSFT'), 'm1');
});

test('createMarketRuntime: starts worker and reports mode', () => {
  let started = false;
  const runtime = createMarketRuntime({
    assets: [{ id: 'a1', symbol: 'AAPL' }],
    latestPrices: [{ symbol: 'AAPL', price: '100' }],
    apiKey: '',
    isMarketOpen: false,
    marketSocket: { broadcast() {} },
    deps: {
      createTickSource: ({ makeSimulated }) => ({ source: makeSimulated(), mode: 'simulated' }),
      createSimulatedTickSource: () => ({ onTick() {}, start() { started = true; }, stop() {} }),
      createFinnhubTickSource: () => ({ onTick() {}, start() {}, stop() {} }),
      createIngestionWorker: ({ tickSource }) => ({
        start() { tickSource.start(); }, stop() { tickSource.stop(); },
      }),
      marketPriceRepository: {},
      priceHistoryRepository: {},
    },
  });
  assert.equal(runtime.mode, 'simulated');
  runtime.start();
  assert.equal(started, true);
  runtime.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/marketdata/runtime'`.

- [ ] **Step 3: Implement the runtime**

Create `backend/src/marketdata/runtime.js`:

```js
const createTickSourceDefault = require('./tickSource');
const createSimulatedTickSourceDefault = require('./simulatedTickSource');
const createFinnhubTickSourceDefault = require('./finnhubTickSource');
const createIngestionWorkerDefault = require('./ingestionWorker');
const marketPriceRepositoryDefault = require('../repositories/marketPrice.repository');
const priceHistoryRepositoryDefault = require('../repositories/priceHistory.repository');

function buildAssetIdBySymbol(assets) {
  return new Map(assets.map((a) => [a.symbol, a.id]));
}

// Assembles the live pipeline: choose a tick source (live vs simulator), wire it
// to the ingestion worker, and expose start/stop. All collaborators are
// injectable via `deps` so this is unit-testable; server.js passes the defaults.
function createMarketRuntime({
  assets,
  latestPrices,
  apiKey,
  isMarketOpen,
  marketSocket,
  deps = {},
}) {
  const {
    createTickSource = createTickSourceDefault,
    createSimulatedTickSource = createSimulatedTickSourceDefault,
    createFinnhubTickSource = createFinnhubTickSourceDefault,
    createIngestionWorker = createIngestionWorkerDefault,
    marketPriceRepository = marketPriceRepositoryDefault,
    priceHistoryRepository = priceHistoryRepositoryDefault,
    intervalMs = Number(process.env.MARKET_TICK_INTERVAL_MS) || 2000,
    throttleMs = Number(process.env.MARKET_HISTORY_THROTTLE_MS) || 1000,
  } = deps;

  const symbols = assets.map((a) => a.symbol);
  const seeds = symbols.map((symbol) => {
    const found = latestPrices.find((p) => p.symbol === symbol);
    return { symbol, price: found ? found.price : '100' };
  });

  const { source, mode } = createTickSource({
    apiKey,
    isMarketOpen,
    makeFinnhub: () => createFinnhubTickSource({ apiKey, symbols }),
    makeSimulated: () => createSimulatedTickSource({ seeds, intervalMs }),
  });

  const worker = createIngestionWorker({
    tickSource: source,
    marketPriceRepository,
    priceHistoryRepository,
    marketSocket,
    assetIdBySymbol: buildAssetIdBySymbol(assets),
    throttleMs,
  });

  return {
    mode,
    start() { worker.start(); },
    stop() { worker.stop(); },
  };
}

module.exports = { buildAssetIdBySymbol, createMarketRuntime };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — runtime reports `simulated` and starts the worker.

- [ ] **Step 5: Wire server.js**

Replace the contents of `backend/src/server.js` with:

```js
require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const pool = require('./config/database');
const assetRepository = require('./repositories/asset.repository');
const marketPriceRepository = require('./repositories/marketPrice.repository');
const createMarketSocket = require('./marketdata/marketSocket');
const { createMarketRuntime } = require('./marketdata/runtime');
const { isUsMarketOpen } = require('./marketdata/marketHours');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await pool.query('SELECT NOW()'); // fail fast if the DB is unreachable

    const server = http.createServer(app);
    const marketSocket = createMarketSocket();
    marketSocket.attach(server);

    const assets = await assetRepository.findAllActive();
    const latestPrices = await marketPriceRepository.findAll();
    const runtime = createMarketRuntime({
      assets,
      latestPrices,
      apiKey: process.env.FINNHUB_API_KEY || '',
      isMarketOpen: isUsMarketOpen(new Date()),
      marketSocket,
    });
    runtime.start();
    console.log(`Market data pipeline started in '${runtime.mode}' mode.`);

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    const shutdown = async () => {
      console.log('Shutting down...');
      runtime.stop();
      marketSocket.close();
      server.close();
      await pool.end();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start the server.', error);
    process.exit(1);
  }
};

startServer();
```

- [ ] **Step 6: Verify the server boots (manual smoke test)**

Run: `npm run db:reset && npm start`
Expected: logs `Market data pipeline started in 'simulated' mode.` (no key set) then `Server is running on http://localhost:5000`. In another shell: `curl http://localhost:5000/api/market/prices` returns JSON; after ~5s the AAPL price differs from the seed (simulator running). Stop with Ctrl-C → logs `Shutting down...` and exits cleanly. Then re-run `npm test` to confirm the suite still passes (the simulator timer is `unref`'d, so tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add backend/src/marketdata/runtime.js backend/src/server.js backend/tests/marketdata.unit.test.js
git commit -m "feat(step6a): wire market runtime + WS into server lifecycle"
```

---

### Task 12: `.env.example`, docs, and TODO/MEMORY updates

**Files:**
- Create: `backend/.env.example`
- Modify: `TODO.md`, `MEMORY.md`

**Interfaces:**
- Produces: documented env vars; updated project trackers. No code/runtime change.

- [ ] **Step 1: Create `.env.example`**

Create `backend/.env.example`:

```bash
# --- Database ---
DATABASE_URL=postgres://user:password@localhost:5432/moneylogix
PORT=5000

# --- Market data (Step 6a) ---
# Finnhub real-time trades WebSocket. Leave UNSET to use the simulated feed
# (also used automatically outside US market hours). Get a free key at
# https://finnhub.io/register
FINNHUB_API_KEY=

# Simulator tick cadence in ms (default 2000).
MARKET_TICK_INTERVAL_MS=2000
# Default candlestick bucket in seconds (the /candles endpoint accepts any value).
MARKET_DEFAULT_CANDLE_SEC=15
# Minimum gap between DB writes per symbol in ms (throttles a busy live feed).
MARKET_HISTORY_THROTTLE_MS=1000
```

- [ ] **Step 2: Update `TODO.md`**

In `TODO.md`, change the `## ⬜ Step 6` heading block. Mark Step 6a items done and note 6b is split out. Replace the Step 6 section with:

```markdown
## 🚧 Step 6 — Market price ingestion
### ✅ Step 6a — Backend ingestion & streaming
- [x] `price_history` ticks table + index; `market_prices` stays latest-only
- [x] Tick sources: Finnhub trades WebSocket + simulated random-walk fallback
- [x] Market-hours/key selector (live when open + keyed, else simulator)
- [x] Ingestion worker: upsert latest + append history (throttled) + WS broadcast
- [x] Browser-facing WebSocket (`/ws/market`) pushing live ticks
- [x] `GET /api/market/prices`, `/prices/:symbol`, `/candles` (on-read OHLC)
- [x] Server lifecycle wiring + graceful shutdown; `.env.example`
### ⬜ Step 6b — Frontend live candlestick chart
- [ ] Candlestick chart (e.g. TradingView lightweight-charts) consuming `/candles` + WS
- [ ] Timeframe switcher; live-forming candle from the WS tick stream
```

Also update the `_Last updated:_` line near the top to `2026-07-01 (Step 6a complete)`.

- [ ] **Step 3: Update `MEMORY.md`**

In `MEMORY.md`, add a row to the Route table for the market endpoints and a short subsystem note. Under the route table, add these rows:

```markdown
| `GET /api/market/prices` | market.routes.js | `marketController.getPrices` | `marketService.getPrices` |
| `GET /api/market/prices/:symbol` | market.routes.js | `marketController.getPrice` | `marketService.getPriceBySymbol` |
| `GET /api/market/candles` | market.routes.js | `marketController.getCandles` | `marketService.getCandles` |
```

And add this section after the "Read paths" section:

```markdown
## Market data pipeline (Step 6a)
`server.js` builds a tick pipeline at boot: `marketdata/tickSource.js` picks the
Finnhub trades WebSocket (`finnhubTickSource`) when `FINNHUB_API_KEY` is set AND
the US market is open (`marketHours.isUsMarketOpen`), else the `simulatedTickSource`
random walk. `ingestionWorker` fans each `{symbol,price,ts}` tick to: WS broadcast
(`marketSocket`, path `/ws/market`), `marketPriceRepository.upsertLatest`
(market_prices) and `priceHistoryRepository.append` (price_history) — the two DB
writes throttled to 1/sec/symbol. Candlesticks are aggregated on-read from
price_history by `priceHistoryRepository.aggregateCandles` (OHLC per time bucket).
```

- [ ] **Step 4: Commit**

```bash
git add backend/.env.example TODO.md MEMORY.md
git commit -m "docs(step6a): env example + TODO/MEMORY updates"
```

---

## Self-Review

**1. Spec coverage:**
- Finnhub trades WS source → Task 5. Simulated fallback → Task 4. Selector (key + market hours) → Task 6. ✓
- `price_history` ticks table → Task 1; `market_prices` latest unchanged, upsert → Task 3. ✓
- Ingestion worker (upsert + append + broadcast, throttle) → Task 8. ✓
- Browser WebSocket push → Task 7; wired in → Task 11. ✓
- Candle aggregate-on-read + endpoints → Tasks 2, 9, 10. ✓
- Error handling (400 interval/range, 404 symbol) → Tasks 9, 10; reconnect/fallback → Tasks 5, 11. ✓
- Lifecycle/graceful shutdown → Task 11. ✓
- `ws` dependency → Task 5. Env/`.env.example`/defaults → Task 12. ✓
- Tests deterministic + offline (simulator + injected clock/rng + time-window isolation) → Tasks 4–11. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code. ✓

**3. Type consistency:** Tick shape `{ symbol, price, ts }` consistent across sources, worker, socket. Repo method names (`upsertLatest`, `findAll`, `findBySymbol`, `append`, `aggregateCandles`, `findAllActive`) match between definitions and callers. `createTickSource` returns `{ source, mode }` consistently in Task 6 and Task 11. Service returns `{ symbol, intervalSec, candles }`, asserted the same in Tasks 9/10. ✓

---

## Notes / things only the user can do

- 🔑 Sign up at https://finnhub.io/register and put the key in `backend/.env` as `FINNHUB_API_KEY=…`. Without it (or outside US market hours) the pipeline runs the simulator — all tests and the local demo work regardless.
- Live-feed verification (real Finnhub ticks) must be done by the user during US market hours with a valid key; it is intentionally out of CI scope.
