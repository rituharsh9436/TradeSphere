'use strict';

// Step 6a — price ingestion & streaming. Boots the app in-process and exercises
// the schema, repositories, candle aggregation, REST endpoints and WS broadcast.
// Assumes schema initialized via `npm run db:reset` (seed AAPL=195, MSFT=430,
// TSLA=250). Isolated by unique time windows so it is order-independent.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');

after(async () => {
  await pool.end();
});

test('price_history table exists with expected columns', async () => {
  const { rows } = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'price_history'
     ORDER BY column_name`
  );
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.ok(cols.id, 'id column present');
  assert.ok(cols.asset_id, 'asset_id column present');
  assert.equal(cols.price, 'numeric');
  assert.match(cols.ts, /timestamp/);
});

const priceHistoryRepository = require('../src/repositories/priceHistory.repository');

// A far-past window unique to this suite so ticks never collide with live data.
const W_FROM = new Date('2000-01-01T00:00:00.000Z');
const W_TO = new Date('2000-01-01T00:10:00.000Z');

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}

test('priceHistory: append + aggregateCandles builds OHLC buckets', async () => {
  const aaplId = await assetIdOf('AAPL');
  // Clean the window first so reruns are deterministic.
  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);

  // Two 60s buckets. Bucket A (00:00): 100,105,102 -> O100 H105 L100 C102.
  // Bucket B (00:01): 103,99       -> O103 H103 L99  C99.
  const ticks = [
    ['2000-01-01T00:00:10.000Z', '100'],
    ['2000-01-01T00:00:20.000Z', '105'],
    ['2000-01-01T00:00:50.000Z', '102'],
    ['2000-01-01T00:01:05.000Z', '103'],
    ['2000-01-01T00:01:40.000Z', '99'],
  ];
  for (const [ts, price] of ticks) {
    await priceHistoryRepository.append(aaplId, price, new Date(ts));
  }

  const candles = await priceHistoryRepository.aggregateCandles({
    symbol: 'AAPL', intervalSec: 60, from: W_FROM, to: W_TO,
  });

  assert.equal(candles.length, 2);
  assert.deepEqual(
    { o: candles[0].open, h: candles[0].high, l: candles[0].low, c: candles[0].close },
    { o: '100.0000', h: '105.0000', l: '100.0000', c: '102.0000' }
  );
  assert.deepEqual(
    { o: candles[1].open, h: candles[1].high, l: candles[1].low, c: candles[1].close },
    { o: '103.0000', h: '103.0000', l: '99.0000', c: '99.0000' }
  );
  assert.equal(typeof candles[0].time, 'string');

  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
});

const marketPriceRepository = require('../src/repositories/marketPrice.repository');
const assetRepository = require('../src/repositories/asset.repository');

test('marketPrice: upsertLatest + reads, asset.findAllActive', async () => {
  const msftId = await assetIdOf('MSFT');

  await marketPriceRepository.upsertLatest(msftId, '441.2500');
  const one = await marketPriceRepository.findBySymbol('MSFT');
  assert.equal(one.symbol, 'MSFT');
  assert.equal(one.price, '441.2500');

  const all = await marketPriceRepository.findAll();
  assert.ok(all.find((p) => p.symbol === 'MSFT' && p.price === '441.2500'));

  assert.equal(await marketPriceRepository.findBySymbol('NOSUCH'), null);

  const active = await assetRepository.findAllActive();
  assert.ok(active.find((a) => a.symbol === 'MSFT' && a.id === msftId));

  // Restore seed price for order-independence.
  await marketPriceRepository.upsertLatest(msftId, '430.0000');
});

const http = require('node:http');
const WebSocket = require('ws');
const createMarketSocket = require('../src/marketdata/marketSocket');

test('marketSocket: broadcast reaches a connected client', async () => {
  const server = http.createServer();
  const socket = createMarketSocket();
  socket.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/market`);
  const got = new Promise((resolve) => client.on('message', (m) => resolve(JSON.parse(m))));
  await new Promise((r) => client.on('open', r));

  socket.broadcast({ type: 'tick', symbol: 'AAPL', price: '195.0000' });
  const msg = await got;
  assert.deepEqual(msg, { type: 'tick', symbol: 'AAPL', price: '195.0000' });

  client.close();
  socket.close();
  await new Promise((r) => server.close(r));
});

const marketService = require('../src/services/market.service');

test('market.service.getCandles: returns OHLC from stored ticks', async () => {
  const aaplId = await assetIdOf('AAPL');
  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
  for (const [ts, price] of [
    ['2000-01-01T00:00:10.000Z', '100'],
    ['2000-01-01T00:00:50.000Z', '108'],
  ]) {
    await priceHistoryRepository.append(aaplId, price, new Date(ts));
  }

  const out = await marketService.getCandles({
    symbol: 'AAPL', interval: '60',
    from: W_FROM.toISOString(), to: W_TO.toISOString(),
  });
  assert.equal(out.intervalSec, 60);
  assert.equal(out.candles.length, 1);
  assert.equal(out.candles[0].open, '100.0000');
  assert.equal(out.candles[0].close, '108.0000');

  await pool.query('DELETE FROM price_history WHERE asset_id = $1 AND ts >= $2 AND ts < $3', [
    aaplId, W_FROM, W_TO,
  ]);
});
