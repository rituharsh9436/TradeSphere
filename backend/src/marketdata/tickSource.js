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
