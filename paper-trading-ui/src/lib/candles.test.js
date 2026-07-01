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
