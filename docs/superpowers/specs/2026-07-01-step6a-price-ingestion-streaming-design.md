# Step 6a — Backend Price Ingestion & Streaming — Design

_Date: 2026-07-01_
_Status: Approved (pending written-spec review)_
_Part of: TODO Step 6 — Market price ingestion. Frontend live candlestick chart is
split into a separate **Step 6b** spec._

## Goal

Replace the static, hand-seeded `market_prices` rows with a **live price pipeline**
that powers a Binomo-style live candlestick chart. Prices arrive as a stream of
ticks, are persisted (latest + history), and are pushed to browser clients in real
time. The candle data for the chart is aggregated on-read from the tick history, so
the "live-forming" candle is simply the current, not-yet-closed time bucket.

This step is the **backend pipeline only** and is fully testable headless. It also
unblocks Step 7 (limit orders), which needs a fresh latest price per asset.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Price source | **Finnhub** live feed | Free tier, real-time US equities |
| Delivery | **Finnhub `trades` WebSocket → backend ingest → our own WS push** | True tick-by-tick for Binomo-style smoothness |
| Candle model | **Aggregate-on-read from ticks** | Single source of truth; flexible intervals; live candle = open bucket |
| History | **New `price_history` (ticks) table** | Required for candlesticks; `market_prices` stays latest-only |
| Fallback | **Simulated random-walk tick source** | Auto-used when market closed / no API key / in tests; deterministic + offline |
| Defaults | **2s simulator tick, 15s default candle** | Smooth but DB-light; endpoint still accepts any interval |
| Scope | **6a backend now, 6b frontend chart next** | Each piece small + testable |

## Architecture

A new **market-data subsystem** that produces and consumes a uniform tick stream.
Everything downstream is agnostic to the tick origin.

```
TickSource ──▶ IngestionWorker ──┬──▶ market_prices  (upsert latest price)
(finnhub|sim)                    ├──▶ price_history  (append tick row)
                                 └──▶ marketSocket    ──▶ browser WS clients
                              REST: GET /api/market/candles  aggregates
                                    price_history → OHLC buckets
```

### Tick contract

All sources emit the same shape; all consumers depend only on this:

```js
// A single trade/price observation.
{ symbol: 'AAPL', price: '195.1200', ts: <ISO-8601 string> }
```

## Components

Files live under `backend/src/` following the existing layered conventions. Each
unit has one purpose and a narrow interface.

- **`marketdata/tickSource.js` (selector/factory)** — chooses the active source:
  use `finnhubTickSource` when `FINNHUB_API_KEY` is set **and** the US market is
  open; otherwise `simulatedTickSource`. Falls back to the simulator if the live
  connection fails. Exposes `start()`, `stop()`, and an `onTick(cb)` subscription.
- **`marketdata/finnhubTickSource.js`** — connects to
  `wss://ws.finnhub.io?token=<KEY>`, subscribes to each active asset symbol, parses
  `{"type":"trade","data":[{s,p,t},...]}` frames into ticks. Reconnect with
  exponential backoff; auth/error frames are logged and trigger simulator fallback.
- **`marketdata/simulatedTickSource.js`** — `setInterval` (2s) random walk from each
  symbol's last known price (seeded from `market_prices`). Bounded step (e.g. ±0.5%).
  Accepts an injectable clock/step for deterministic tests.
- **`marketdata/ingestionWorker.js`** — subscribes to the tick source; per tick:
  1. `marketPriceRepository.upsertLatest(assetId, price)`
  2. `priceHistoryRepository.append(assetId, price, ts)` — **throttled to ≤1 row/sec
     per symbol** so a busy live feed can't flood the DB.
  3. `marketSocket.broadcast(tick)`.
  A failed `price_history` insert is logged and swallowed (never crashes the worker).
- **`marketdata/marketSocket.js`** — our own `ws` server attached to the HTTP server
  at path `/ws/market`. Clients may send `{type:'subscribe',symbols:[...]}`; the
  server pushes `{type:'tick', ...}` messages. Tracks clients, cleans up on close.
- **`services/market.service.js`** — candle aggregation + price reads; validation
  (interval bounds, known symbol, sane `from/to`).
- **`repositories/priceHistory.repository.js`** — `append()` and the OHLC
  aggregation query.
- **`repositories/marketPrice.repository.js`** — `upsertLatest()`, `findAll()`,
  `findBySymbol()`. (May extend the existing `asset.repository.js` instead; chosen at
  implementation time to match existing boundaries — a thin dedicated repo is
  preferred to keep `asset.repository` focused.)
- **`controllers/market.controller.js` + `routes/market.routes.js`** — REST surface,
  wrapped in `catchAsync`. Mounted at `/market` in `routes/index.js`.

## Schema changes (`backend/src/scripts/init-db.js`)

Add, idempotently (`CREATE TABLE IF NOT EXISTS`), keeping `market_prices` unchanged:

```sql
-- 8. Price history (raw ticks) — source for candlestick aggregation.
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    price DECIMAL(15, 4) NOT NULL CHECK (price >= 0),
    ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_price_history_asset_ts ON price_history(asset_id, ts);
```

## Endpoints

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/market/prices` | all latest prices | from `market_prices ⋈ assets` |
| `GET /api/market/prices/:symbol` | one latest price | 404 if symbol unknown |
| `GET /api/market/candles?symbol=&interval=&from=&to=` | OHLC buckets | `interval` seconds (default 15); 400 on bad interval/range |
| `ws://<host>/ws/market` | live tick stream | optional `subscribe` message |

### Candle aggregation

OHLC is computed from `price_history` by bucketing on `ts`. Each bucket returns
`{ time, open, high, low, close }` where `open`/`close` are the first/last tick in the
bucket (by `ts`) and `high`/`low` are the max/min price. Implemented with a
time-bucket expression (e.g. `to_timestamp(floor(extract(epoch from ts)/$interval)*$interval)`)
plus `first_value`/`last_value` window functions or an equivalent grouped query.
The current (latest) bucket may be partial — that is the live-forming candle.

## Data flow (chart perspective — informs Step 6b)

1. Chart loads → `GET /candles` for the visible history.
2. Chart opens `ws://…/ws/market` and subscribes to its symbol.
3. Each incoming tick updates the current candle's `close`, and `high`/`low` if
   exceeded.
4. When a tick crosses the bucket boundary, the current candle closes and a new one
   opens. No server-side candle state needed; the open bucket is derived.

## Error handling

- Finnhub WS: reconnect with exponential backoff; auth/error frames → log + simulator
  fallback.
- Market-hours check selects live vs simulator at start and on reconnection.
- `price_history` insert failure: logged, swallowed; worker continues.
- REST endpoints reuse `AppError` + `catchAsync` + the central error handler:
  - 400 — invalid `interval` (non-numeric / out of bounds), inverted/oversized range.
  - 404 — unknown symbol.
- Graceful shutdown: `server.js` stops the tick source, closes the WS server and DB
  pool cleanly.

## Lifecycle (`backend/src/server.js`)

`startServer()` currently pings the DB then `app.listen(5000)`. It changes to:
1. Ping DB (`SELECT NOW()`).
2. Create an `http.Server` from the Express `app`.
3. Attach `marketSocket` to that server (`/ws/market`).
4. Start the tick source + ingestion worker.
5. `server.listen(5000)`.
6. On `SIGINT`/`SIGTERM`: stop worker → close WS → close server → `pool.end()`.

## Testing (Node built-in runner, no new test deps)

- **Unit**
  - `simulatedTickSource` emits valid, bounded ticks at the injected clock.
  - Candle aggregation: a known tick set → expected OHLC buckets (boundary, single-tick
    bucket, empty range).
  - Throttle: ≤1 history row/sec/symbol under a burst of ticks.
- **Integration**
  - Drive simulator ticks → assert `market_prices` upserted, `price_history` rows
    written, `GET /candles` returns expected OHLC, `GET /prices` reflects latest.
  - WS: connect a test client, push a tick, assert a `tick` message is received.
- Deterministic + offline: simulator + injected timestamps; no live network in CI.
  Live Finnhub path is exercised manually with a real key (out of CI scope).

## New dependency

- **`ws`** — WebSocket library, used for both the Finnhub client and our server.

## Configuration / env (`backend/.env`, documented in `.env.example`)

| Var | Meaning | Default |
|---|---|---|
| `FINNHUB_API_KEY` | Finnhub token; absence forces simulator | _(unset → simulator)_ |
| `MARKET_TICK_INTERVAL_MS` | simulator tick cadence | `2000` |
| `MARKET_DEFAULT_CANDLE_SEC` | default candle bucket | `15` |
| `MARKET_HISTORY_THROTTLE_MS` | min gap between history rows/symbol | `1000` |

## Out of scope (future steps)

- **Step 6b** — frontend live candlestick chart (TradingView `lightweight-charts` or
  similar) consuming `/candles` + the WS.
- Historical backfill from a provider; multi-exchange symbols; crypto/forex feeds.
- Per-user WS auth (arrives with Step 10 auth).

## Things only the user can do

- 🔑 Create a free Finnhub account and put the key in `backend/.env` as
  `FINNHUB_API_KEY=…` (needed only for the live feed; simulator covers dev/tests).
