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
