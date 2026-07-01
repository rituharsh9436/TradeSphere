# Step 6b — Frontend Live Candlestick Chart & Trading Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Depends on:** Step 6a (backend price ingestion & streaming — merged to `main`)

## Goal

Rebuild the `paper-trading-ui` Market page into a live trading view: a real-time
price list, a candlestick chart (TradingView `lightweight-charts`) with a timeframe
switcher, and a Buy/Sell panel. Real-time updates flow from the backend market
WebSocket; candle history comes from the REST `/candles` endpoint; the live-forming
candle is built on the client from the WS tick stream.

## Context

- Frontend stack: Vite + React 19 + Tailwind v4 + react-router-dom + axios.
- Current frontend is early scaffolding: `Market.jsx`/`Dashboard.jsx` are stubs
  hitting non-existent endpoints (`/stocks`, `/portfolio`) and rendering `₹`;
  `StockCard.jsx`, `TradeModel.jsx`, `HoldingsTable.jsx` are empty files.
- Backend (Step 6a) exposes:
  - `GET /api/market/prices` → `{ status, results, data: [{ symbol, price, updatedAt }] }`
  - `GET /api/market/prices/:symbol` → `{ status, data: { symbol, price, updatedAt } }`
  - `GET /api/market/candles?symbol=&interval=&from=&to=` →
    `{ status, data: { symbol, intervalSec, candles: [{ time /*ISO*/, open, high, low, close }] } }`
  - `POST /api/orders` `{ userId, symbol, side, quantity }` → fill result
  - WebSocket `ws://localhost:5000/ws/market` broadcasting every tick
    `{ type: 'tick', symbol, price /*4dp string*/, ts /*ISO*/ }` for ALL symbols.
  - Users: `POST /api/users`, `GET /api/users/:id` (+ wallet/positions/portfolio).
    No list-users endpoint yet.
- Money/prices are strings (4dp) throughout, USD. UI must render `$`, not `₹`.

## Decisions (from brainstorming)

1. **Placement:** Rebuild the Market page as one cohesive page (live list + chart).
2. **Library:** `lightweight-charts` (native candlestick + real-time `series.update`).
3. **Timeframes:** `15s / 1m / 5m / 1h` (interval seconds `15 / 60 / 300 / 3600`),
   default **1m**.
4. **Trade scope:** Include a Buy/Sell action posting to `POST /api/orders`.
5. **Current user:** Dev "active user" persisted in `localStorage`, chosen via a
   Navbar picker (select existing or register new). Requires a backend list-users
   endpoint. Bridge until real auth (Step 10).
6. **Currency:** Switch UI from `₹` to `$`.
7. **Testing:** Add Vitest; unit-test the pure candle logic. Chart/WS wiring
   verified by manual smoke test.

## Architecture

Single shared WS connection feeds two consumers: (a) the price list (all symbols),
(b) the selected symbol's live candle. REST seeds initial state.

```
                 ┌───────────────────────── Market page ─────────────────────────┐
GET /market/prices ─────────────▶ PriceList (live rows, click = select symbol)
GET /market/candles?symbol&interval ─▶ CandlestickChart (history) ─▶ series.setData
ws://…/ws/market ──ticks──▶ useMarketData ──┬─▶ prices map ─▶ PriceList
                                            └─▶ selected symbol tick ─▶ lib/candles
                                                 applyTickToCandles ─▶ series.update
TradePanel ── qty + side ─▶ POST /api/orders { userId(active), symbol, side, qty }
Navbar UserPicker ─▶ ActiveUserContext (localStorage) ─▶ TradePanel
```

**Selection/timeframe change:** refetch `/candles` for `{symbol, interval}`, call
`series.setData(history)`, and reset live-candle state so new ticks extend the
freshly loaded history.

## Components & Interfaces

### Frontend (`paper-trading-ui/src/`)

- **`services/api.js`** (modify) — set `baseURL` to `http://localhost:5000/api`.
- **`services/marketApi.js`** (new) — thin REST helpers over `api`:
  - `getPrices() → Promise<Array<{symbol, price, updatedAt}>>`
  - `getCandles({ symbol, interval, from, to }) → Promise<{symbol, intervalSec, candles}>`
  - `getUsers() → Promise<Array<{id, username, email}>>`
  - `registerUser({ username, email }) → Promise<user>`
  - `placeOrder({ userId, symbol, side, quantity }) → Promise<result>`
- **`services/marketSocket.js`** (new) — WS client factory:
  - `createMarketSocket(url) → { subscribe(cb) → unsubscribe(), close() }`
  - Parses incoming JSON, invokes callbacks with the tick object; auto-reconnects
    with a fixed delay; ignores non-`tick` frames.
- **`lib/candles.js`** (new, PURE — the unit-tested core):
  - `bucketStart(epochMs, intervalSec) → number` — floor to bucket (ms).
  - `applyTickToCandles(candles, tick, intervalSec) → newCandlesArray` — returns a
    new array where the tick either appends a new candle (open=high=low=close=price,
    time=bucketStart) or updates the last candle (high=max, low=min, close=price).
    Times in **seconds** to match lightweight-charts' UTCTimestamp.
  - `toChartCandles(apiCandles) → Array<{time:seconds, open, high, low, close:number}>`
    — maps API string OHLC + ISO time to the chart's numeric shape.
- **`hooks/useMarketData.js`** (new) — opens one socket for the page:
  - returns `{ prices: Map<symbol, {price, ts}>, subscribeSymbol(symbol, cb) }`.
- **`context/ActiveUserContext.jsx`** (new) — React context holding `{ activeUser,
  setActiveUser }`, persisted to `localStorage` key `mlx.activeUser`.
- **`components/UserPicker.jsx`** (new, mounted in Navbar) — shows active user;
  dropdown to select from `getUsers()` or register a new one; writes context.
- **`components/CandlestickChart.jsx`** (new) — a thin renderer. Props
  `{ candles, seriesKey }` where `candles` is the numeric-shaped array (history +
  live-forming candle) owned by the Market page, and `seriesKey = "${symbol}:${interval}"`.
  Creates a lightweight-charts candlestick series once in a ref'd container. Effect
  logic: when `seriesKey` changes (symbol/timeframe switch) call `series.setData(candles)`
  (full reload); otherwise (same key, array mutated by a new tick) call
  `series.update(candles[candles.length - 1])`. All bucketing/OHLC math lives in the
  Market page via `lib/candles` — the chart never touches tick logic.
- **`components/TimeframeSwitcher.jsx`** (new) — buttons for the four timeframes;
  `{ value, onChange }`.
- **`components/PriceList.jsx`** (new) — rows `{symbol, price}` with up/down color
  vs previous price; `{ prices, selected, onSelect }`.
- **`components/TradePanel.jsx`** (new, replaces empty TradeModel.jsx) — quantity
  input + Buy/Sell buttons; disabled when no active user; calls `placeOrder`;
  renders fill result or error message.
- **`pages/Market.jsx`** (rewrite) — composes PriceList + TimeframeSwitcher +
  CandlestickChart + TradePanel; owns selected symbol, interval, and live-candle
  state (via `lib/candles`). Renders `$`.
- **`App.jsx` / `components/Navbar.jsx`** (modify) — wrap app in
  `ActiveUserProvider`; render `UserPicker` in the Navbar.

### Backend (`backend/src/`)

- **`repositories/user.repository.js`** — add `findAll(client = pool) → Array<{id,
  username, email, created_at}>` (no password/sensitive fields beyond existing schema).
- **`services/user.service.js`** — add `list() → Promise<Array>` delegating to repo.
- **`controllers/user.controller.js`** — add `list` (catchAsync) →
  `{ status, results, data }`.
- **`routes/user.routes.js`** — add `router.get('/', userController.list)` (before
  `/:id`).

## Live-candle algorithm

Given interval `N` seconds and a tick `{ price, ts }`:
1. `bucket = floor(epochSeconds(ts) / N) * N`.
2. If `candles` empty or `bucket > last.time`: append
   `{ time: bucket, open: p, high: p, low: p, close: p }`.
3. Else (`bucket === last.time`): `last.high = max(last.high, p)`,
   `last.low = min(last.low, p)`, `last.close = p`.
4. A tick with `bucket < last.time` (out-of-order / stale) is ignored.
5. Parent calls `series.update(last)` — lightweight-charts upserts by `time`.

This mirrors the backend SQL aggregation (open/close = first/last by ts; high/low =
max/min), so a client candle equals what a later `/candles` refetch would return.

## Error handling

- **WS drop:** `marketSocket` auto-reconnects on close with a fixed delay; the price
  list simply stops updating until reconnect (no crash). On reconnect the chart keeps
  its last state; next tick resumes the live candle.
- **REST errors:** `marketApi` surfaces axios errors; components show a small inline
  message (e.g. "Couldn't load prices"). A failed `/candles` leaves the previous
  chart data intact.
- **Order errors:** `POST /api/orders` returns 4xx (insufficient funds/holdings,
  unknown symbol, bad quantity); TradePanel renders `body.message`.
- **No active user:** Buy/Sell disabled with a hint to pick a user.

## Testing

- **Vitest (new devDep)** unit tests for `lib/candles.js`:
  - `bucketStart` floors correctly for each interval.
  - `applyTickToCandles` appends a new candle when the tick crosses a bucket
    boundary and updates OHLC in-bucket (open unchanged, high/low/close correct).
  - `toChartCandles` converts string OHLC + ISO time to numeric/seconds.
  - out-of-order tick is ignored.
- **Manual smoke test** (documented in the plan): `npm run dev` against a running
  backend — verify list ticks live, chart renders history for AAPL, live candle
  forms/extends, timeframe switch refetches, selecting a user enables Buy/Sell and an
  order fills (balance/position change reflected).

## Out of scope (YAGNI)

- Real authentication/login (Step 10) — the localStorage active-user is a bridge.
- Per-symbol WS subscription protocol (backend broadcasts all symbols; client filters).
- Portfolio/holdings rework, Dashboard rebuild, Leaderboard — separate tasks.
- Chart drawing tools, indicators, volume pane — only OHLC candles for 6b.
- Persisting chart zoom/pan or timeframe across reloads.

## File summary

**Create (frontend):** `services/marketApi.js`, `services/marketSocket.js`,
`lib/candles.js`, `hooks/useMarketData.js`, `context/ActiveUserContext.jsx`,
`components/UserPicker.jsx`, `components/CandlestickChart.jsx`,
`components/TimeframeSwitcher.jsx`, `components/PriceList.jsx`,
`components/TradePanel.jsx`, plus Vitest config + `lib/candles.test.js`.

**Modify (frontend):** `services/api.js`, `pages/Market.jsx`, `App.jsx`,
`components/Navbar.jsx`, `package.json` (add `lightweight-charts`, `vitest`).

**Modify (backend):** `repositories/user.repository.js`, `services/user.service.js`,
`controllers/user.controller.js`, `routes/user.routes.js` (+ a list-users test).

**Modify (docs):** `TODO.md` (mark 6b done), `MEMORY.md` (add `GET /api/users` row +
frontend market view note).
