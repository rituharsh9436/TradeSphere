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
