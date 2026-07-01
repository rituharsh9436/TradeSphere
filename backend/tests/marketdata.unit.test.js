'use strict';

// Pure unit tests for the marketdata subsystem — no DB, no network. Sources and
// the worker take injected deps so behavior is deterministic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const createSimulatedTickSource = require('../src/marketdata/simulatedTickSource');

test('simulatedTickSource: tickOnce emits one 4dp tick per seed via rng', () => {
  const fixedNow = new Date('2020-05-01T12:00:00.000Z');
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '100' }, { symbol: 'MSFT', price: '200' }],
    volatility: 0.01,
    rng: () => 1, // delta = (1*2 - 1) * 0.01 = +0.01 -> +1%
    now: () => fixedNow,
  });

  const ticks = [];
  src.onTick((t) => ticks.push(t));
  src.tickOnce();

  assert.equal(ticks.length, 2);
  const aapl = ticks.find((t) => t.symbol === 'AAPL');
  assert.equal(aapl.price, '101.0000'); // 100 * 1.01
  assert.equal(aapl.ts, fixedNow.toISOString());
  const msft = ticks.find((t) => t.symbol === 'MSFT');
  assert.equal(msft.price, '202.0000'); // 200 * 1.01
});

test('simulatedTickSource: price never goes negative', () => {
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '0.01' }],
    volatility: 1, // huge swings
    rng: () => 0, // delta = (0*2 - 1) * 1 = -1 -> -100%
  });
  let last;
  src.onTick((t) => { last = t; });
  src.tickOnce();
  assert.equal(last.price, '0.0000');
});

const createFinnhubTickSource = require('../src/marketdata/finnhubTickSource');

test('finnhubTickSource: parseTradeMessage maps trade frames to 4dp ticks', () => {
  const src = createFinnhubTickSource({ apiKey: 'k', symbols: ['AAPL'] });

  const frame = JSON.stringify({
    type: 'trade',
    data: [
      { s: 'AAPL', p: 195.123, t: 1577836800000 }, // 2020-01-01T00:00:00Z
      { s: 'MSFT', p: 430, t: 1577836800000 },
    ],
  });
  const ticks = src.parseTradeMessage(frame);
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks[0], {
    symbol: 'AAPL',
    price: '195.1230',
    ts: new Date(1577836800000).toISOString(),
  });

  // Non-trade frames (e.g. ping) yield no ticks.
  assert.deepEqual(src.parseTradeMessage(JSON.stringify({ type: 'ping' })), []);
  assert.deepEqual(src.parseTradeMessage('not json'), []);
});

test('finnhubTickSource: subscribes to all symbols on open', () => {
  const sent = [];
  // Fake ws: captures send() payloads and exposes open hook.
  class FakeWS {
    constructor() { this.handlers = {}; FakeWS.last = this; }
    on(evt, cb) { this.handlers[evt] = cb; return this; }
    send(msg) { sent.push(msg); }
    close() { this.closed = true; }
  }
  const src = createFinnhubTickSource({
    apiKey: 'k', symbols: ['AAPL', 'MSFT'], WebSocketImpl: FakeWS,
  });
  src.start();
  FakeWS.last.handlers.open();

  assert.deepEqual(sent, [
    JSON.stringify({ type: 'subscribe', symbol: 'AAPL' }),
    JSON.stringify({ type: 'subscribe', symbol: 'MSFT' }),
  ]);
  src.stop();
  assert.equal(FakeWS.last.closed, true);
});

const { isUsMarketOpen } = require('../src/marketdata/marketHours');
const createTickSource = require('../src/marketdata/tickSource');

test('isUsMarketOpen: weekday midday open, weekend + off-hours closed', () => {
  // 2020-01-02 (Thu) 14:30 UTC = 09:30 ET (EST) -> open.
  assert.equal(isUsMarketOpen(new Date('2020-01-02T14:30:00Z')), true);
  // 2020-01-02 (Thu) 22:00 UTC = 17:00 ET -> closed.
  assert.equal(isUsMarketOpen(new Date('2020-01-02T22:00:00Z')), false);
  // 2020-01-04 is a Saturday -> closed.
  assert.equal(isUsMarketOpen(new Date('2020-01-04T15:00:00Z')), false);
});

test('createTickSource: picks finnhub only with key + open market', () => {
  const make = (tag) => () => ({ tag });
  const open = createTickSource({
    apiKey: 'k', isMarketOpen: true, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(open.mode, 'finnhub');
  assert.equal(open.source.tag, 'fh');

  const closed = createTickSource({
    apiKey: 'k', isMarketOpen: false, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(closed.mode, 'simulated');

  const noKey = createTickSource({
    apiKey: '', isMarketOpen: true, makeFinnhub: make('fh'), makeSimulated: make('sim'),
  });
  assert.equal(noKey.mode, 'simulated');
});

const createIngestionWorker = require('../src/marketdata/ingestionWorker');

function fakeSource() {
  let cb = null;
  return {
    onTick(fn) { cb = fn; },
    start() {},
    stop() {},
    push(tick) { cb(tick); },
  };
}

test('ingestionWorker: broadcasts every tick, throttles DB writes per symbol', () => {
  const upserts = [];
  const appends = [];
  const broadcasts = [];
  const src = fakeSource();
  let clock = 1000;

  const worker = createIngestionWorker({
    tickSource: src,
    marketPriceRepository: { upsertLatest: async (id, p) => { upserts.push([id, p]); } },
    priceHistoryRepository: { append: async (id, p) => { appends.push([id, p]); } },
    marketSocket: { broadcast: (m) => broadcasts.push(m) },
    assetIdBySymbol: new Map([['AAPL', 'aapl-id']]),
    throttleMs: 1000,
    now: () => clock,
  });
  worker.start();

  src.push({ symbol: 'AAPL', price: '100.0000', ts: 't1' }); // clock 1000 -> writes
  src.push({ symbol: 'AAPL', price: '101.0000', ts: 't2' }); // clock 1000 -> throttled
  clock = 2000;
  src.push({ symbol: 'AAPL', price: '102.0000', ts: 't3' }); // clock 2000 -> writes
  src.push({ symbol: 'NOPE', price: '5.0000', ts: 't4' });   // unknown symbol -> skipped DB

  assert.equal(broadcasts.length, 4); // every tick broadcast
  assert.deepEqual(upserts, [['aapl-id', '100.0000'], ['aapl-id', '102.0000']]);
  assert.deepEqual(appends, [['aapl-id', '100.0000'], ['aapl-id', '102.0000']]);
  assert.deepEqual(broadcasts[0], { type: 'tick', symbol: 'AAPL', price: '100.0000', ts: 't1' });
});

const marketService = require('../src/services/market.service');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('market.service.getCandles: rejects bad interval and range before DB', async () => {
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '0' }), 400);
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: 'abc' }), 400);
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '99999999' }), 400);
  await rejectsWith(
    () => marketService.getCandles({
      symbol: 'AAPL', interval: '15',
      from: '2020-01-02T00:00:00Z', to: '2020-01-01T00:00:00Z', // from >= to
    }),
    400
  );
  // 1s buckets over a 24h default window = 86400 buckets > MAX_BUCKETS.
  await rejectsWith(() => marketService.getCandles({ symbol: 'AAPL', interval: '1' }), 400);
});

const { buildAssetIdBySymbol, createMarketRuntime } = require('../src/marketdata/runtime');

test('buildAssetIdBySymbol maps symbol -> id', () => {
  const map = buildAssetIdBySymbol([{ id: 'a1', symbol: 'AAPL' }, { id: 'm1', symbol: 'MSFT' }]);
  assert.equal(map.get('AAPL'), 'a1');
  assert.equal(map.get('MSFT'), 'm1');
});

test('createMarketRuntime: starts worker and reports mode', () => {
  let started = false;
  const runtime = createMarketRuntime({
    assets: [{ id: 'a1', symbol: 'AAPL' }],
    latestPrices: [{ symbol: 'AAPL', price: '100' }],
    apiKey: '',
    isMarketOpen: false,
    marketSocket: { broadcast() {} },
    deps: {
      createTickSource: ({ makeSimulated }) => ({ source: makeSimulated(), mode: 'simulated' }),
      createSimulatedTickSource: () => ({ onTick() {}, start() { started = true; }, stop() {} }),
      createFinnhubTickSource: () => ({ onTick() {}, start() {}, stop() {} }),
      createIngestionWorker: ({ tickSource }) => ({
        start() { tickSource.start(); }, stop() { tickSource.stop(); },
      }),
      marketPriceRepository: {},
      priceHistoryRepository: {},
    },
  });
  assert.equal(runtime.mode, 'simulated');
  runtime.start();
  assert.equal(started, true);
  runtime.stop();
});
