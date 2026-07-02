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
  // A malformed tick (unparseable ts or price) yields NaN, which slips past both
  // the `>` and `<` guards below and would silently corrupt the last candle —
  // drop it instead.
  if (Number.isNaN(time) || Number.isNaN(price)) {
    return candles;
  }
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
