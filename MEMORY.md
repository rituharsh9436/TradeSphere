# Money-logix — Backend Context

A paper-trading engine. Node.js + Express + PostgreSQL (raw SQL via `pg`), strict
layered architecture: **Routes → Controllers → Services → Repositories → DB**.
Each layer depends only on the one beneath it. Money math uses `decimal.js` at
4 dp to match the `DECIMAL(15,4)` schema.

## Stack
- Express (`backend/src/app.js`), runs on port `5000`
- PostgreSQL via `pg` Pool (`backend/src/config/database.js`, max 20 conns)
- `decimal.js` for all monetary calculations
- Frontend: React + axios (`paper-trading-ui/src/services/api.js`, baseURL `http://localhost:5000`)

## Bootstrap
- `server.js` → `startServer()`: pings DB (`SELECT NOW()`), then `app.listen(5000)`.
- `app.js`: `cors()` → `express.json()` → `GET /api/health` → `app.use('/api', routes)`
  → `notFound` → `errorHandler` (last).

## Route table (who handles what)
| Method & Path | Route file | Controller fn | Service fn |
|---|---|---|---|
| `POST /api/users` | user.routes.js | `userController.register` | `userService.register` |
| `GET /api/users/:id` | user.routes.js | `userController.getById` | `userService.getById` |
| `GET /api/users/:id/wallet` | user.routes.js | `userController.getWallet` | `walletService.getByUserId` |
| `GET /api/users/:id/positions` | user.routes.js | `userController.getPositions` | `portfolioService.getPositions` |
| `GET /api/users/:id/portfolio` | user.routes.js | `userController.getPortfolio` | `portfolioService.getPortfolio` |
| `POST /api/orders` | order.routes.js | `orderController.place` | `orderService.placeMarketOrder` / `placeLimitOrder` |
| `GET /api/orders/user/:userId` | order.routes.js | `orderController.listForUser` | `orderService.listOrders` |
| `DELETE /api/orders/:id` | order.routes.js | `orderController.cancel` | `orderService.cancelOrder` |
| `GET /api/market/prices` | market.routes.js | `marketController.getPrices` | `marketService.getPrices` |
| `GET /api/market/prices/:symbol` | market.routes.js | `marketController.getPrice` | `marketService.getPriceBySymbol` |
| `GET /api/market/candles` | market.routes.js | `marketController.getCandles` | `marketService.getCandles` |
| `GET /api/users` | user.routes.js | `userController.list` | `userService.list` |

`routes/index.js` mounts `/users`, `/orders` and `/market`. Every controller method is wrapped
in `utils/catchAsync.js` so rejected promises forward to the central error handler.

## Core write path — place market order
`POST /api/orders {userId, symbol, side, quantity}`
→ `order.service.js placeMarketOrder()` holds ALL business logic + validation, run
inside `utils/withTransaction.js` (BEGIN…COMMIT / ROLLBACK):
1. `userRepository.findById` (users)
2. `assetRepository.findBySymbol` (assets) + `assetRepository.getPrice` (market_prices) → 422 if unpriced
3. `walletRepository.findByUserIdForUpdate` — **`SELECT … FOR UPDATE` lock = serialization point, prevents over-draft**
4. `positionRepository.findForUpdate` (positions FOR UPDATE)
5. BUY: check balance ≥ gross → create/update position with quantity-weighted avg buy price; else 422.
   SELL: check holdings ≥ qty → reduce position (avg price unchanged); else 422.
6. `walletRepository.updateBalance` (wallets)
7. `orderRepository.create` status=`FILLED` (orders)
8. `transactionRepository.create` (transactions — immutable ledger)
Returns `{ order, transaction, wallet, executedPrice, totalAmount }`.

## Register user (atomic two-table write)
`userService.register()` inside `withTransaction`: `findByEmail` (409 if exists) →
`userRepository.create` (users) → `walletRepository.create` (wallets, defaults
starting cash **$100,000**). A user can never exist without a wallet.

## Read paths (no transaction)
- `portfolioService.getPortfolio/getPositions` → `portfolioRepository.findHoldingsWithPrices`
  (positions ⋈ assets ⋈ market_prices), then `valueHolding()`: marketValue, costBasis,
  unrealized P/L, ROI vs $100k starting capital. Tracks `unpricedSymbols`.
- `walletService.getByUserId` (wallets), `userService.getById` (users),
  `orderService.listOrders` → `orderRepository.listByUser` (orders ⋈ assets).

## Market data pipeline (Step 6a)
`server.js` builds a tick pipeline at boot: `marketdata/tickSource.js` picks the
Finnhub trades WebSocket (`finnhubTickSource`) when `FINNHUB_API_KEY` is set AND
the US market is open (`marketHours.isUsMarketOpen`), else the `simulatedTickSource`
random walk. `ingestionWorker` fans each `{symbol,price,ts}` tick to: WS broadcast
(`marketSocket`, path `/ws/market`), `marketPriceRepository.upsertLatest`
(market_prices) and `priceHistoryRepository.append` (price_history) — the two DB
writes throttled to 1/sec/symbol. Candlesticks are aggregated on-read from
price_history by `priceHistoryRepository.aggregateCandles` (OHLC per time bucket).

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

## Frontend market view (Step 6b)
`paper-trading-ui` Market page (`pages/Market.jsx`) is the live trading view.
`hooks/useMarketData.js` opens one `services/marketSocket.js` WebSocket to
`ws://localhost:5000/ws/market`, keeping a latest-price map (PriceList) and fanning
raw ticks out. The selected symbol's candle is built client-side by pure helpers in
`lib/candles.js` (`applyTickToCandles`/`bucketStart`), seeded from `/api/market/candles`
and drawn by `components/CandlestickChart.jsx` (lightweight-charts v5). Trading uses a
dev "active user" in `context/ActiveUserContext.jsx` (localStorage, set via Navbar
`UserPicker`, backed by `GET /api/users`), posting to `POST /api/orders`.

## Error handling
Any layer throws `utils/AppError.js` (statusCode, isOperational) → caught by
`catchAsync` → `middleware/errorHandler.js`:
- PG `23505` → 409, `23514`/`23502` → 400, `22P02` → 400 (bad UUID)
- `AppError` → its own status/message; otherwise → 500 (logged).

## Repository → table map
| Repository | Tables |
|---|---|
| user.repository.js | users |
| wallet.repository.js | wallets |
| asset.repository.js | assets, market_prices |
| position.repository.js | positions (⋈ assets) |
| order.repository.js | orders (⋈ assets) |
| transaction.repository.js | transactions |
| portfolio.repository.js | positions ⋈ assets ⋈ market_prices |

All repos import the shared `config/database.js` pool and accept an optional
`client` param, so each method runs standalone **or** inside a `withTransaction` block.

## DB scripts
- `backend/src/scripts/init-db.js` — schema/seed
- `backend/src/scripts/reset-db.js` — reset

## Tests
- `backend/tests/portfolio.test.js`, `backend/tests/scenario.test.js`
