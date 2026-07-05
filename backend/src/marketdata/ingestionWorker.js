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
  onPriceUpdate = null,
}) {
  const lastWriteAt = new Map(); // symbol -> ms timestamp of last DB write
  const matching = new Set(); // symbols with an in-flight matcher run

  async function persist(assetId, tick) {
    try {
      // Kick off both writes before awaiting so neither is deferred behind the
      // other's microtask; they're independent rows and can go concurrently.
      await Promise.all([
        marketPriceRepository.upsertLatest(assetId, tick.price),
        priceHistoryRepository.append(assetId, tick.price, tick.ts),
      ]);
    } catch (err) {
      console.error('Ingestion DB write failed:', err.message);
    }
  }

  // Run the limit-order matcher for this symbol, at most one run per symbol at a
  // time (a busy feed shouldn't stack matcher runs). Errors never break the stream.
  function runMatcher(symbol, price) {
    if (!onPriceUpdate || matching.has(symbol)) return;
    matching.add(symbol);
    let result;
    try {
      result = onPriceUpdate({ symbol, price });
    } catch (err) {
      console.error('Limit matcher hook failed:', err.message);
      matching.delete(symbol);
      return;
    }
    // Clear the in-flight flag only once the matcher's async work settles.
    Promise.resolve(result)
      .catch((err) => console.error('Limit matcher hook failed:', err.message))
      .finally(() => matching.delete(symbol));
  }

  function handleTick(tick) {
    marketSocket.broadcast({ type: 'tick', symbol: tick.symbol, price: tick.price, ts: tick.ts });

    const assetId = assetIdBySymbol.get(tick.symbol);
    if (!assetId) return; // not a tracked asset — nothing to persist

    // Match limit orders on EVERY tick — a crossing that appears and reverts
    // inside the throttle window must still fill. Only the DB writes are throttled.
    runMatcher(tick.symbol, tick.price);

    const t = now();
    const last = lastWriteAt.get(tick.symbol);
    if (last !== undefined && t - last < throttleMs) return; // throttle DB writes only
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
