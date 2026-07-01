# Step 6b — Frontend Live Candlestick Chart & Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `paper-trading-ui` Market page into a live trading view — real-time price list, TradingView `lightweight-charts` candlestick with a `15s/1m/5m/1h` switcher (live-forming candle from the WS tick stream), and a Buy/Sell panel using a dev "active user".

**Architecture:** One shared WebSocket to the Step 6a backend (`ws://localhost:5000/ws/market`) feeds a live prices map (price list) and, for the selected symbol, drives a client-built candle via pure helpers in `lib/candles.js`. REST (`/api/market/prices`, `/api/market/candles`) seeds initial state. Buy/Sell posts to `POST /api/orders` with a userId held in an `ActiveUserContext` (localStorage), chosen via a Navbar picker backed by a new `GET /api/users` endpoint.

**Tech Stack:** React 19, Vite, Tailwind v4, react-router-dom, axios, `lightweight-charts` v5 (new dep), Vitest (new dev dep). Backend: Node/Express 5, `pg`, Node built-in test runner.

## Global Constraints

- Frontend is ESM (`"type": "module"`); backend is CommonJS.
- Money/prices are strings at 4dp (USD) from the backend. Render `$`, never `₹`.
- `lightweight-charts` v5 API: `createChart(container, opts)`, `chart.addSeries(CandlestickSeries, opts)`, `series.setData(arr)`, `series.update(bar)`. Candle `time` is a **UTCTimestamp = integer seconds**; `update()` requires `time >= last`.
- Tick contract from WS: `{ type: 'tick', symbol, price /*4dp string*/, ts /*ISO-8601*/ }`, broadcast for all symbols; the client filters by symbol.
- Candle REST shape: `{ status, data: { symbol, intervalSec, candles: [{ time /*ISO*/, open, high, low, close /* strings */ }] } }`.
- Backend layering: `routes → controllers → services → repositories → DB`; repo methods take a trailing `client = pool`; errors via `AppError(message, statusCode)`; controllers wrapped in `catchAsync`.
- Backend tests: `npm test` from `backend/` (`node --test --test-concurrency=1 "tests/**/*.test.js"`), DB initialized via `npm run db:reset` (seed AAPL=195, MSFT=430, TSLA=250). Order-independent — restore/clean anything mutated.
- Frontend unit tests: `npm test` from `paper-trading-ui/` (Vitest). Only pure logic (`lib/candles.js`, `services/marketSocket.js`) is unit-tested; UI is verified by the manual smoke test in Task 11.
- Run frontend commands from `paper-trading-ui/`, backend commands from `backend/`.

---

## File Structure

**Backend — Modify:**
- `src/repositories/user.repository.js` — add `findAll`.
- `src/services/user.service.js` — add `list`.
- `src/controllers/user.controller.js` — add `list`.
- `src/routes/user.routes.js` — add `GET /` (before `/:id`).
- Test: `tests/users.test.js` (new).

**Frontend — Create:**
- `src/services/marketApi.js` — REST helpers.
- `src/services/marketSocket.js` — WS client (tested).
- `src/lib/candles.js` — pure candle helpers (tested).
- `src/lib/candles.test.js`, `src/services/marketSocket.test.js` — Vitest.
- `src/hooks/useMarketData.js` — shared socket hook.
- `src/context/ActiveUserContext.jsx` — active-user context + provider.
- `src/components/UserPicker.jsx`, `PriceList.jsx`, `TimeframeSwitcher.jsx`, `CandlestickChart.jsx`, `TradePanel.jsx`.

**Frontend — Modify:**
- `src/services/api.js` — fix `baseURL`.
- `src/pages/Market.jsx` — full rewrite.
- `src/App.jsx` — wrap in `ActiveUserProvider`.
- `src/components/Navbar.jsx` — mount `UserPicker`.
- `package.json` — add `lightweight-charts`, `vitest`, `test` script.

**Docs — Modify:** `TODO.md`, `MEMORY.md`.

---

### Task 1: Backend `GET /api/users` list endpoint

**Files:**
- Modify: `backend/src/repositories/user.repository.js`, `src/services/user.service.js`, `src/controllers/user.controller.js`, `src/routes/user.routes.js`
- Test: `backend/tests/users.test.js` (new)

**Interfaces:**
- Produces: `GET /api/users` → `{ status:'success', results:N, data:[{id, username, email, created_at}] }`.
- `userRepository.findAll(client = pool) → Promise<Array>`, `userService.list() → Promise<Array>`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/users.test.js`:

```js
'use strict';

// Step 6b — GET /api/users list endpoint (powers the frontend dev user picker).
// Registers a user via the API, then asserts it appears in the list.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');

let server;
let base;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

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

test('GET /api/users lists registered users (no sensitive fields)', async () => {
  const tag = `${process.pid}_${process.hrtime.bigint().toString(36)}`;
  const email = `picker_${tag}@test.com`;
  const created = await apiJson('POST', '/api/users', { username: 'picker', email });
  assert.equal(created.status, 201);

  const list = await apiJson('GET', '/api/users');
  assert.equal(list.status, 200);
  assert.equal(list.body.status, 'success');
  assert.equal(typeof list.body.results, 'number');
  const found = list.body.data.find((u) => u.email === email);
  assert.ok(found, 'registered user appears in list');
  assert.equal(found.username, 'picker');
  assert.equal(found.password, undefined); // no such column, but assert shape stays lean
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:reset && npm test`
Expected: FAIL — `GET /api/users` returns 404 (route not mounted) so `list.status` is 404.

- [ ] **Step 3: Add `findAll` to the repository**

In `backend/src/repositories/user.repository.js`, add inside `userRepository` (after `findByEmail`, keeping trailing-comma style):

```js
  async findAll(client = pool) {
    const { rows } = await client.query(
      `SELECT id, username, email, created_at FROM users ORDER BY created_at ASC`
    );
    return rows;
  },
```

- [ ] **Step 4: Add `list` to the service**

In `backend/src/services/user.service.js`, add inside `userService` (after `getById`):

```js
  async list() {
    return userRepository.findAll();
  },
```

- [ ] **Step 5: Add `list` to the controller**

In `backend/src/controllers/user.controller.js`, add inside `userController` (after `register`):

```js
  list: catchAsync(async (req, res) => {
    const users = await userService.list();
    res.status(200).json({ status: 'success', results: users.length, data: users });
  }),
```

- [ ] **Step 6: Mount the route (before `/:id`)**

In `backend/src/routes/user.routes.js`, add the list route immediately after the `router.post('/', ...)` line and before `router.get('/:id', ...)` so `/` isn't shadowed by `/:id`:

```js
router.get('/', userController.list);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run db:reset && npm test`
Expected: PASS — the registered user appears in the list; full suite stays green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/user.repository.js backend/src/services/user.service.js backend/src/controllers/user.controller.js backend/src/routes/user.routes.js backend/tests/users.test.js
git commit -m "feat(step6b): GET /api/users list endpoint for dev user picker"
```

---

### Task 2: Frontend tooling — `lightweight-charts` + Vitest

**Files:**
- Modify: `paper-trading-ui/package.json`
- Create: `paper-trading-ui/vitest.config.js`, `paper-trading-ui/src/lib/sanity.test.js` (temporary)

**Interfaces:**
- Produces: `npm test` runs Vitest; `lightweight-charts` importable.

- [ ] **Step 1: Install dependencies**

Run (from `paper-trading-ui/`):

```bash
npm install lightweight-charts
npm install -D vitest
```

Expected: `lightweight-charts` under `dependencies`, `vitest` under `devDependencies`.

- [ ] **Step 2: Add the test script**

In `paper-trading-ui/package.json`, add to `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create the Vitest config**

Create `paper-trading-ui/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

// Pure-logic unit tests (node env). UI is verified by manual smoke test.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
```

- [ ] **Step 4: Add a temporary sanity test**

Create `paper-trading-ui/src/lib/sanity.test.js`:

```js
import { test, expect } from 'vitest';

test('vitest runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS — 1 test passes; confirms Vitest works.

- [ ] **Step 6: Remove the sanity test and commit**

```bash
rm src/lib/sanity.test.js
git add package.json package-lock.json vitest.config.js
git commit -m "chore(step6b): add lightweight-charts + vitest tooling"
```

---

### Task 3: `lib/candles.js` — pure candle helpers

**Files:**
- Create: `paper-trading-ui/src/lib/candles.js`
- Test: `paper-trading-ui/src/lib/candles.test.js`

**Interfaces:**
- Produces:
  - `bucketStart(epochMs, intervalSec) → number` — bucket start in **seconds**.
  - `toChartCandles(apiCandles) → Array<{time:number, open:number, high, low, close}>` — API strings/ISO → numeric/seconds.
  - `applyTickToCandles(candles, tick, intervalSec) → Array` — pure; appends a new candle on bucket cross, updates OHLC in-bucket, ignores stale ticks. `tick` = `{ price:string, ts:ISO }`; `candles` are the numeric chart shape.

- [ ] **Step 1: Write the failing test**

Create `paper-trading-ui/src/lib/candles.test.js`:

```js
import { test, expect } from 'vitest';
import { bucketStart, toChartCandles, applyTickToCandles } from './candles';

test('bucketStart floors to the interval in seconds', () => {
  // 2000-01-01T00:00:50Z = 946684850000 ms. 60s bucket -> 00:00:00 = 946684800.
  expect(bucketStart(Date.parse('2000-01-01T00:00:50.000Z'), 60)).toBe(946684800);
  expect(bucketStart(Date.parse('2000-01-01T00:01:05.000Z'), 60)).toBe(946684860);
  expect(bucketStart(Date.parse('2000-01-01T00:00:20.000Z'), 15)).toBe(946684815);
});

test('toChartCandles maps API string OHLC + ISO time to numeric/seconds', () => {
  const out = toChartCandles([
    { time: '2000-01-01T00:00:00.000Z', open: '100.0000', high: '105.0000', low: '99.0000', close: '102.0000' },
  ]);
  expect(out).toEqual([{ time: 946684800, open: 100, high: 105, low: 99, close: 102 }]);
});

test('applyTickToCandles appends a new candle when the tick crosses a bucket', () => {
  const candles = [{ time: 946684800, open: 100, high: 105, low: 100, close: 102 }];
  const next = applyTickToCandles(candles, { price: '103.0000', ts: '2000-01-01T00:01:05.000Z' }, 60);
  expect(next).toHaveLength(2);
  expect(next[1]).toEqual({ time: 946684860, open: 103, high: 103, low: 103, close: 103 });
  expect(next[0]).toBe(candles[0]); // earlier candles untouched (referentially)
});

test('applyTickToCandles updates OHLC within the current bucket', () => {
  const candles = [{ time: 946684800, open: 100, high: 100, low: 100, close: 100 }];
  const a = applyTickToCandles(candles, { price: '105.0000', ts: '2000-01-01T00:00:20.000Z' }, 60);
  const b = applyTickToCandles(a, { price: '98.0000', ts: '2000-01-01T00:00:40.000Z' }, 60);
  expect(b[0]).toEqual({ time: 946684800, open: 100, high: 105, low: 98, close: 98 });
});

test('applyTickToCandles ignores a stale (older-bucket) tick', () => {
  const candles = [{ time: 946684860, open: 103, high: 103, low: 99, close: 99 }];
  const next = applyTickToCandles(candles, { price: '200.0000', ts: '2000-01-01T00:00:10.000Z' }, 60);
  expect(next).toBe(candles);
});

test('applyTickToCandles seeds the first candle from an empty array', () => {
  const next = applyTickToCandles([], { price: '50.0000', ts: '2000-01-01T00:00:10.000Z' }, 15);
  expect(next).toEqual([{ time: 946684800, open: 50, high: 50, low: 50, close: 50 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './candles'` / functions undefined.

- [ ] **Step 3: Implement the helpers**

Create `paper-trading-ui/src/lib/candles.js`:

```js
// Pure candlestick helpers shared by the Market page and its chart. Times are
// UTCTimestamps (integer seconds) to match lightweight-charts. Kept dependency-
// free and side-effect-free so they are trivially unit-testable.

// Floor an epoch (ms) to the start of its interval bucket, in seconds.
export function bucketStart(epochMs, intervalSec) {
  const sec = Math.floor(epochMs / 1000);
  return Math.floor(sec / intervalSec) * intervalSec;
}

// Convert backend candles (string OHLC, ISO time) to the chart's numeric shape.
export function toChartCandles(apiCandles) {
  return apiCandles.map((c) => ({
    time: Math.floor(Date.parse(c.time) / 1000),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));
}

// Fold one tick into the candle array. Returns a NEW array (or the same
// reference when the tick is stale and nothing changes). Appends a fresh candle
// when the tick starts a new bucket, otherwise updates the last candle's OHLC.
export function applyTickToCandles(candles, tick, intervalSec) {
  const time = bucketStart(Date.parse(tick.ts), intervalSec);
  const price = Number(tick.price);
  const last = candles[candles.length - 1];

  if (!last || time > last.time) {
    return [...candles, { time, open: price, high: price, low: price, close: price }];
  }
  if (time < last.time) {
    return candles; // stale / out-of-order — ignore
  }
  const updated = {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  };
  return [...candles.slice(0, -1), updated];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all six candle tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candles.js src/lib/candles.test.js
git commit -m "feat(step6b): pure candle bucketing + live-tick helpers"
```

---

### Task 4: `services/api.js` fix + `services/marketApi.js`

**Files:**
- Modify: `paper-trading-ui/src/services/api.js`
- Create: `paper-trading-ui/src/services/marketApi.js`

**Interfaces:**
- Consumes: the shared axios instance (`baseURL: http://localhost:5000/api`).
- Produces (all return the unwrapped `data` payload):
  - `getPrices() → Promise<Array<{symbol, price, updatedAt}>>`
  - `getCandles({ symbol, interval, from, to }) → Promise<{symbol, intervalSec, candles}>`
  - `getUsers() → Promise<Array<{id, username, email}>>`
  - `registerUser({ username, email }) → Promise<user>`
  - `placeOrder({ userId, symbol, side, quantity }) → Promise<result>`

- [ ] **Step 1: Fix the axios base URL**

Replace the contents of `paper-trading-ui/src/services/api.js`:

```js
import axios from "axios";

// All backend routes live under /api (see backend routes/index.js).
const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export default api;
```

- [ ] **Step 2: Implement the market API helpers**

Create `paper-trading-ui/src/services/marketApi.js`:

```js
import api from "./api";

// Thin, typed-ish wrappers over the backend REST endpoints. Each returns the
// inner `data` payload so callers don't repeat `res.data.data`.

export async function getPrices() {
  const res = await api.get("/market/prices");
  return res.data.data;
}

export async function getCandles({ symbol, interval, from, to }) {
  const res = await api.get("/market/candles", {
    params: { symbol, interval, from, to },
  });
  return res.data.data; // { symbol, intervalSec, candles }
}

export async function getUsers() {
  const res = await api.get("/users");
  return res.data.data;
}

export async function registerUser({ username, email }) {
  const res = await api.post("/users", { username, email });
  return res.data.data;
}

export async function placeOrder({ userId, symbol, side, quantity }) {
  const res = await api.post("/orders", { userId, symbol, side, quantity });
  return res.data.data;
}
```

- [ ] **Step 3: Verify it imports cleanly**

Run: `npm run build`
Expected: build succeeds (no import/syntax errors). (These wrappers are exercised end-to-end in the Task 11 smoke test.)

- [ ] **Step 4: Commit**

```bash
git add src/services/api.js src/services/marketApi.js
git commit -m "feat(step6b): fix api baseURL + market REST helpers"
```

---

### Task 5: `services/marketSocket.js` — WS client

**Files:**
- Create: `paper-trading-ui/src/services/marketSocket.js`
- Test: `paper-trading-ui/src/services/marketSocket.test.js`

**Interfaces:**
- Produces: `createMarketSocket(url, { WebSocketImpl = WebSocket, reconnectMs = 2000 } = {}) → { subscribe(cb) → unsubscribe(), close() }`.
  - Parses each message; invokes subscribers with the tick object `{ type:'tick', symbol, price, ts }`; ignores non-`tick` frames and malformed JSON.
  - Reconnects on close with `reconnectMs` delay unless `close()` was called.

- [ ] **Step 1: Write the failing test**

Create `paper-trading-ui/src/services/marketSocket.test.js`:

```js
import { test, expect, vi } from 'vitest';
import { createMarketSocket } from './marketSocket';

// Minimal fake WebSocket capturing handlers so we can drive events by hand.
class FakeWS {
  constructor(url) { this.url = url; FakeWS.last = this; this.onmessage = null; this.onclose = null; this.onopen = null; this.closed = false; }
  close() { this.closed = true; if (this.onclose) this.onclose(); }
}

test('createMarketSocket dispatches tick frames to subscribers', () => {
  const sock = createMarketSocket('ws://x/ws/market', { WebSocketImpl: FakeWS });
  const ticks = [];
  sock.subscribe((t) => ticks.push(t));

  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'tick', symbol: 'AAPL', price: '195.0000', ts: 't1' }) });
  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'ping' }) }); // ignored
  FakeWS.last.onmessage({ data: 'not json' });                       // ignored

  expect(ticks).toEqual([{ type: 'tick', symbol: 'AAPL', price: '195.0000', ts: 't1' }]);
  sock.close();
  expect(FakeWS.last.closed).toBe(true);
});

test('unsubscribe stops delivery; close prevents reconnect', () => {
  vi.useFakeTimers();
  const sock = createMarketSocket('ws://x/ws/market', { WebSocketImpl: FakeWS, reconnectMs: 1000 });
  const seen = [];
  const off = sock.subscribe((t) => seen.push(t));
  off();
  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'tick', symbol: 'AAPL', price: '1', ts: 't' }) });
  expect(seen).toHaveLength(0);

  sock.close();
  const before = FakeWS.last;
  vi.advanceTimersByTime(5000); // no reconnect after explicit close
  expect(FakeWS.last).toBe(before);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './marketSocket'`.

- [ ] **Step 3: Implement the socket**

Create `paper-trading-ui/src/services/marketSocket.js`:

```js
// Browser WebSocket client for the backend market feed. One connection fans
// every tick out to all subscribers. Reconnects automatically unless closed by
// the caller. WebSocketImpl is injectable so the parsing/dispatch logic is
// unit-testable without a real socket.
export function createMarketSocket(url, { WebSocketImpl = WebSocket, reconnectMs = 2000 } = {}) {
  const listeners = new Set();
  let ws = null;
  let stopped = false;
  let retryTimer = null;

  function connect() {
    if (stopped) return;
    ws = new WebSocketImpl(url);

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!msg || msg.type !== 'tick') return;
      for (const cb of listeners) cb(msg);
    };
    ws.onclose = () => {
      if (stopped) return;
      retryTimer = setTimeout(connect, reconnectMs);
    };
  }

  connect();

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — dispatch + unsubscribe/close tests green (plus candle tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/marketSocket.js src/services/marketSocket.test.js
git commit -m "feat(step6b): market WebSocket client with reconnect"
```

---

### Task 6: `hooks/useMarketData.js` — shared socket hook

**Files:**
- Create: `paper-trading-ui/src/hooks/useMarketData.js`

**Interfaces:**
- Consumes: `createMarketSocket` from `services/marketSocket`.
- Produces: `useMarketData() → { prices: Record<symbol, {price, ts}>, subscribeTick(cb) → unsubscribe }`.
  - Opens exactly one socket for the component's lifetime; updates `prices` on every tick; `subscribeTick` lets a consumer receive raw ticks (used by the chart for the selected symbol).

- [ ] **Step 1: Implement the hook**

Create `paper-trading-ui/src/hooks/useMarketData.js`:

```js
import { useEffect, useRef, useState, useCallback } from "react";
import { createMarketSocket } from "../services/marketSocket";

const WS_URL = "ws://localhost:5000/ws/market";

// Opens one shared market socket and exposes (a) a live latest-price map for the
// price list and (b) a raw tick subscription for the selected-symbol candle.
export function useMarketData() {
  const [prices, setPrices] = useState({});
  const listenersRef = useRef(new Set());

  const subscribeTick = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    const sock = createMarketSocket(WS_URL);
    const off = sock.subscribe((tick) => {
      setPrices((prev) => ({ ...prev, [tick.symbol]: { price: tick.price, ts: tick.ts } }));
      for (const cb of listenersRef.current) cb(tick);
    });
    return () => {
      off();
      sock.close();
    };
  }, []);

  return { prices, subscribeTick };
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (Behavior verified in Task 11.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMarketData.js
git commit -m "feat(step6b): useMarketData hook (shared socket + prices map)"
```

---

### Task 7: Active-user context, picker, and app wiring

**Files:**
- Create: `paper-trading-ui/src/context/ActiveUserContext.jsx`, `src/components/UserPicker.jsx`
- Modify: `paper-trading-ui/src/App.jsx`, `src/components/Navbar.jsx`

**Interfaces:**
- Consumes: `getUsers`, `registerUser` from `services/marketApi`.
- Produces:
  - `ActiveUserProvider` (component) + `useActiveUser() → { activeUser, setActiveUser }` where `activeUser` is `{ id, username } | null`, persisted to `localStorage["mlx.activeUser"]`.
  - `<UserPicker />` — Navbar control to select an existing user or register a new one.

- [ ] **Step 1: Implement the context/provider**

Create `paper-trading-ui/src/context/ActiveUserContext.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "mlx.activeUser";
const ActiveUserContext = createContext(null);

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Holds the dev "active user" ({ id, username }) used for trading until real
// auth (Step 10). Persisted to localStorage so it survives reloads.
export function ActiveUserProvider({ children }) {
  const [activeUser, setActiveUser] = useState(readStored);

  useEffect(() => {
    if (activeUser) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeUser));
    else localStorage.removeItem(STORAGE_KEY);
  }, [activeUser]);

  return (
    <ActiveUserContext.Provider value={{ activeUser, setActiveUser }}>
      {children}
    </ActiveUserContext.Provider>
  );
}

export function useActiveUser() {
  const ctx = useContext(ActiveUserContext);
  if (!ctx) throw new Error("useActiveUser must be used within ActiveUserProvider");
  return ctx;
}
```

- [ ] **Step 2: Implement the picker**

Create `paper-trading-ui/src/components/UserPicker.jsx`:

```jsx
import { useEffect, useState } from "react";
import { getUsers, registerUser } from "../services/marketApi";
import { useActiveUser } from "../context/ActiveUserContext";

// Navbar control for the dev active user: select an existing user or register a
// new one. Writes the choice into ActiveUserContext (localStorage-backed).
function UserPicker() {
  const { activeUser, setActiveUser } = useActiveUser();
  const [users, setUsers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", email: "" });
  const [error, setError] = useState(null);

  useEffect(() => {
    getUsers().then(setUsers).catch(() => setError("Couldn't load users"));
  }, []);

  function onSelect(e) {
    const id = e.target.value;
    const u = users.find((x) => x.id === id);
    setActiveUser(u ? { id: u.id, username: u.username } : null);
  }

  async function onCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      const u = await registerUser(form);
      setUsers((prev) => [...prev, u]);
      setActiveUser({ id: u.id, username: u.username });
      setCreating(false);
      setForm({ username: "", email: "" });
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    }
  }

  return (
    <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
      <select value={activeUser?.id || ""} onChange={onSelect}>
        <option value="">— select user —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.username}</option>
        ))}
      </select>
      <button type="button" onClick={() => setCreating((v) => !v)}>+ new</button>
      {creating && (
        <form onSubmit={onCreate} style={{ display: "flex", gap: "4px" }}>
          <input
            placeholder="username" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} required
          />
          <input
            placeholder="email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required
          />
          <button type="submit">create</button>
        </form>
      )}
      {error && <span style={{ color: "crimson" }}>{error}</span>}
    </div>
  );
}

export default UserPicker;
```

- [ ] **Step 3: Wrap the app in the provider**

Replace `paper-trading-ui/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Market from "./pages/Market";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Navbar from "./components/Navbar";
import { ActiveUserProvider } from "./context/ActiveUserContext";

function App() {
  return (
    <ActiveUserProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/market" element={<Market />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </BrowserRouter>
    </ActiveUserProvider>
  );
}

export default App;
```

- [ ] **Step 4: Mount the picker in the Navbar**

Replace `paper-trading-ui/src/components/Navbar.jsx`:

```jsx
import { Link } from "react-router-dom";
import UserPicker from "./UserPicker";

function Navbar() {
  return (
    <nav style={{ padding: "10px", display: "flex", gap: "20px", alignItems: "center" }}>
      <Link to="/">Dashboard</Link>
      <Link to="/market">Market</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <Link to="/profile">Profile</Link>
      <UserPicker />
    </nav>
  );
}

export default Navbar;
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/context/ActiveUserContext.jsx src/components/UserPicker.jsx src/App.jsx src/components/Navbar.jsx
git commit -m "feat(step6b): active-user context + Navbar user picker"
```

---

### Task 8: `PriceList` + `TimeframeSwitcher`

**Files:**
- Create: `paper-trading-ui/src/components/PriceList.jsx`, `src/components/TimeframeSwitcher.jsx`

**Interfaces:**
- Produces:
  - `<PriceList prices selected onSelect />` — `prices`: `Record<symbol,{price,ts}>`; renders rows sorted by symbol, `$` price, highlights `selected`, calls `onSelect(symbol)`.
  - `<TimeframeSwitcher value onChange />` — buttons for `15s/1m/5m/1h`; `value`/`onChange` are interval seconds (number). Exports `TIMEFRAMES` = `[{label,seconds}]`.

- [ ] **Step 1: Implement TimeframeSwitcher**

Create `paper-trading-ui/src/components/TimeframeSwitcher.jsx`:

```jsx
// Timeframe options map UI labels to the backend /candles `interval` (seconds).
export const TIMEFRAMES = [
  { label: "15s", seconds: 15 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "1h", seconds: 3600 },
];

function TimeframeSwitcher({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.seconds}
          type="button"
          onClick={() => onChange(tf.seconds)}
          style={{ fontWeight: value === tf.seconds ? "bold" : "normal" }}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}

export default TimeframeSwitcher;
```

- [ ] **Step 2: Implement PriceList**

Create `paper-trading-ui/src/components/PriceList.jsx`:

```jsx
// Live latest-price rows. `prices` is the map from useMarketData; each row shows
// the current price and is clickable to select that symbol for the chart.
function PriceList({ prices, selected, onSelect }) {
  const symbols = Object.keys(prices).sort();

  if (symbols.length === 0) {
    return <div>Waiting for prices…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {symbols.map((symbol) => (
        <button
          key={symbol}
          type="button"
          onClick={() => onSelect(symbol)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            fontWeight: symbol === selected ? "bold" : "normal",
          }}
        >
          <span>{symbol}</span>
          <span>${Number(prices[symbol].price).toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}

export default PriceList;
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/PriceList.jsx src/components/TimeframeSwitcher.jsx
git commit -m "feat(step6b): price list + timeframe switcher components"
```

---

### Task 9: `CandlestickChart`

**Files:**
- Create: `paper-trading-ui/src/components/CandlestickChart.jsx`

**Interfaces:**
- Consumes: `lightweight-charts` (`createChart`, `CandlestickSeries`).
- Produces: `<CandlestickChart candles seriesKey />` — `candles`: numeric chart shape (history + live-forming candle); `seriesKey`: string that changes on every full reload (symbol/timeframe switch or refetch). On `seriesKey` change → `series.setData(candles)`; otherwise → `series.update(last candle)`.

- [ ] **Step 1: Implement the chart**

Create `paper-trading-ui/src/components/CandlestickChart.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

// Thin renderer over lightweight-charts. All OHLC/tick math lives upstream in
// lib/candles; this component only draws. `seriesKey` changing means "full
// reload" (setData); otherwise a changed `candles` array means "one new tick"
// (update the latest bar).
function CandlestickChart({ candles, seriesKey }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const prevKeyRef = useRef(null);

  // Create the chart once; clean up on unmount (and StrictMode remount).
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "rgb(38, 166, 154)",
      downColor: "rgb(239, 83, 80)",
      wickUpColor: "rgb(38, 166, 154)",
      wickDownColor: "rgb(239, 83, 80)",
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    prevKeyRef.current = null; // force a setData on the first data effect

    const onResize = () => chart.applyOptions({ width: containerRef.current.clientWidth });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Push data: full reload when the key changes, else update the last bar.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (seriesKey !== prevKeyRef.current) {
      series.setData(candles);
      prevKeyRef.current = seriesKey;
    } else if (candles.length > 0) {
      series.update(candles[candles.length - 1]);
    }
  }, [candles, seriesKey]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}

export default CandlestickChart;
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (confirms the `lightweight-charts` v5 imports resolve).

- [ ] **Step 3: Commit**

```bash
git add src/components/CandlestickChart.jsx
git commit -m "feat(step6b): lightweight-charts candlestick renderer"
```

---

### Task 10: `TradePanel`

**Files:**
- Create: `paper-trading-ui/src/components/TradePanel.jsx`

**Interfaces:**
- Consumes: `placeOrder` from `services/marketApi`; `useActiveUser`.
- Produces: `<TradePanel symbol price />` — quantity input + Buy/Sell; disabled without an active user; posts `{ userId, symbol, side, quantity }`; renders the fill result or the backend error message.

- [ ] **Step 1: Implement the panel**

Create `paper-trading-ui/src/components/TradePanel.jsx`:

```jsx
import { useState } from "react";
import { placeOrder } from "../services/marketApi";
import { useActiveUser } from "../context/ActiveUserContext";

// Buy/Sell for the selected symbol using the dev active user. Thin adapter over
// POST /api/orders; surfaces the backend's fill result or error message.
function TradePanel({ symbol, price }) {
  const { activeUser } = useActiveUser();
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState(null); // { ok, message }
  const [busy, setBusy] = useState(false);

  async function submit(side) {
    setBusy(true);
    setStatus(null);
    try {
      const result = await placeOrder({
        userId: activeUser.id,
        symbol,
        side,
        quantity: Number(quantity),
      });
      setStatus({ ok: true, message: `${side} ${quantity} ${symbol} @ $${Number(result.executedPrice).toFixed(2)}` });
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!activeUser) {
    return <div>Select a user (top-right) to trade.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div>Trading as <strong>{activeUser.username}</strong></div>
      <div>{symbol} @ ${Number(price).toFixed(2)}</div>
      <input
        type="number" min="0" step="any" value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" disabled={busy} onClick={() => submit("BUY")}>Buy</button>
        <button type="button" disabled={busy} onClick={() => submit("SELL")}>Sell</button>
      </div>
      {status && (
        <div style={{ color: status.ok ? "green" : "crimson" }}>{status.message}</div>
      )}
    </div>
  );
}

export default TradePanel;
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/TradePanel.jsx
git commit -m "feat(step6b): trade panel (Buy/Sell via active user)"
```

---

### Task 11: Market page composition + smoke test

**Files:**
- Modify: `paper-trading-ui/src/pages/Market.jsx` (full rewrite)

**Interfaces:**
- Consumes: `useMarketData`, `getCandles`, `toChartCandles`, `applyTickToCandles`, `PriceList`, `TimeframeSwitcher` (+ `TIMEFRAMES`), `CandlestickChart`, `TradePanel`.

- [ ] **Step 1: Rewrite the Market page**

Replace `paper-trading-ui/src/pages/Market.jsx`:

```jsx
import { useEffect, useRef, useState } from "react";
import { useMarketData } from "../hooks/useMarketData";
import { getCandles } from "../services/marketApi";
import { toChartCandles, applyTickToCandles } from "../lib/candles";
import PriceList from "../components/PriceList";
import TimeframeSwitcher, { TIMEFRAMES } from "../components/TimeframeSwitcher";
import CandlestickChart from "../components/CandlestickChart";
import TradePanel from "../components/TradePanel";

// Live trading view: price list (left), candlestick chart + timeframe (center),
// trade panel (right). The page owns selection, interval and candle state; the
// chart is a thin renderer and lib/candles owns the tick math.
function Market() {
  const { prices, subscribeTick } = useMarketData();
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalSec] = useState(60); // default 1m
  const [candles, setCandles] = useState([]);
  const [loadId, setLoadId] = useState(0);
  const [error, setError] = useState(null);

  // Refs so the tick subscription doesn't need to re-bind on each selection.
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  symbolRef.current = symbol;
  intervalRef.current = interval;

  // Load candle history whenever symbol/timeframe changes; bump loadId so the
  // chart does a full setData rather than a per-tick update.
  useEffect(() => {
    let cancelled = false;
    getCandles({ symbol, interval })
      .then((data) => {
        if (cancelled) return;
        setCandles(toChartCandles(data.candles));
        setLoadId((n) => n + 1);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load candles"); });
    return () => { cancelled = true; };
  }, [symbol, interval]);

  // Fold live ticks for the selected symbol into the current candle.
  useEffect(() => {
    return subscribeTick((tick) => {
      if (tick.symbol !== symbolRef.current) return;
      setCandles((prev) => applyTickToCandles(prev, tick, intervalRef.current));
    });
  }, [subscribeTick]);

  const seriesKey = `${symbol}:${interval}:${loadId}`;
  const livePrice = prices[symbol]?.price ?? "0";

  return (
    <div style={{ padding: "16px" }}>
      <h1>Market</h1>
      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ minWidth: "160px" }}>
          <h3>Symbols</h3>
          <PriceList prices={prices} selected={symbol} onSelect={setSymbol} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>{symbol}</h3>
            <TimeframeSwitcher value={interval} onChange={setIntervalSec} />
          </div>
          {error && <div style={{ color: "crimson" }}>{error}</div>}
          <CandlestickChart candles={candles} seriesKey={seriesKey} />
        </div>

        <div style={{ minWidth: "220px" }}>
          <h3>Trade</h3>
          <TradePanel symbol={symbol} price={livePrice} />
        </div>
      </div>
    </div>
  );
}

export default Market;
```

- [ ] **Step 2: Full frontend build + unit tests**

Run: `npm run build && npm test`
Expected: build succeeds; Vitest passes (candles + marketSocket).

- [ ] **Step 3: Manual smoke test (backend running)**

In `backend/`: `npm run db:reset && npm start` (leave running).
In `paper-trading-ui/`: `npm run dev`, open the printed URL, go to `/market`. Verify:
1. The symbol list shows AAPL/MSFT/TSLA and prices tick/update live.
2. The candlestick chart renders history for the selected symbol; within a few seconds a live candle forms/extends.
3. Clicking another symbol reloads the chart; switching timeframe (`15s/1m/5m/1h`) refetches history.
4. Top-right: register a new user (or select one). Buy 1 AAPL → a green fill message with the executed price appears; an invalid order (e.g. Sell more than held) shows the backend error in red.
5. No console errors; stopping the backend then restarting it, the price list resumes (WS reconnect).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Market.jsx
git commit -m "feat(step6b): live Market page (list + chart + trade)"
```

---

### Task 12: Docs — TODO + MEMORY

**Files:**
- Modify: `TODO.md`, `MEMORY.md`

- [ ] **Step 1: Mark Step 6b done in `TODO.md`**

In `TODO.md`, replace the Step 6b block:

```markdown
### ✅ Step 6b — Frontend live candlestick chart
- [x] Candlestick chart (lightweight-charts) consuming `/candles` + WS
- [x] Timeframe switcher (15s/1m/5m/1h); live-forming candle from the WS tick stream
- [x] Rebuilt Market page: live price list + chart + Buy/Sell (dev active user)
```

Also update the `_Last updated:_` line to `2026-07-02 (Step 6b complete)`.

- [ ] **Step 2: Update `MEMORY.md`**

In `MEMORY.md`, add a row to the Route table (after the market rows):

```markdown
| `GET /api/users` | user.routes.js | `userController.list` | `userService.list` |
```

And add this section after the "Market data pipeline (Step 6a)" section:

```markdown
## Frontend market view (Step 6b)
`paper-trading-ui` Market page (`pages/Market.jsx`) is the live trading view.
`hooks/useMarketData.js` opens one `services/marketSocket.js` WebSocket to
`ws://localhost:5000/ws/market`, keeping a latest-price map (PriceList) and fanning
raw ticks out. The selected symbol's candle is built client-side by pure helpers in
`lib/candles.js` (`applyTickToCandles`/`bucketStart`), seeded from `/api/market/candles`
and drawn by `components/CandlestickChart.jsx` (lightweight-charts v5). Trading uses a
dev "active user" in `context/ActiveUserContext.jsx` (localStorage, set via Navbar
`UserPicker`, backed by `GET /api/users`), posting to `POST /api/orders`.
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md MEMORY.md
git commit -m "docs(step6b): mark Step 6b complete in TODO/MEMORY"
```

---

## Self-Review

**1. Spec coverage:**
- Rebuilt Market page (list + chart) → Tasks 8, 9, 11. ✓
- lightweight-charts candlestick + real-time update → Task 9. ✓
- Timeframes 15s/1m/5m/1h, default 1m → Tasks 8, 11. ✓
- Live-candle algorithm (pure, tested) → Task 3. ✓
- Single shared WS + prices map → Tasks 5, 6. ✓
- REST helpers + baseURL fix → Task 4. ✓
- Buy/Sell via active user → Tasks 7, 10. ✓
- Dev active user in localStorage + Navbar picker → Task 7. ✓
- Backend `GET /api/users` → Task 1. ✓
- `₹`→`$` → Tasks 8, 10, 11 (all price rendering uses `$`). ✓
- Vitest for pure logic; manual smoke for UI → Tasks 2, 3, 5, 11. ✓
- Error handling (WS reconnect, REST inline errors, order errors, no-user disable) → Tasks 5, 8, 10, 11. ✓
- Docs → Task 12. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full file/section content. ✓

**3. Type consistency:** Tick shape `{ type, symbol, price, ts }` consistent across `marketSocket` → `useMarketData` → `applyTickToCandles`. Candle numeric shape `{ time, open, high, low, close }` consistent across `toChartCandles`, `applyTickToCandles`, `CandlestickChart`. `interval` (seconds, number) consistent across `TimeframeSwitcher`, `getCandles`, `applyTickToCandles`, `Market`. `activeUser` `{ id, username }` consistent across context, `UserPicker`, `TradePanel`. `seriesKey` includes `loadId` so full reloads always `setData`. ✓

---

## Notes / things only the user can do

- The manual smoke test (Task 11 Step 3) requires the backend running with a reachable Postgres (`npm run db:reset && npm start`) and is the primary verification for all UI wiring — it cannot run in CI.
- Live Finnhub data only flows during US market hours with `FINNHUB_API_KEY` set; otherwise the simulator drives ticks, which is sufficient for the smoke test.
