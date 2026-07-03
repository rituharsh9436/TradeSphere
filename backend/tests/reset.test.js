'use strict';

// Step 9 — reset / panic button. Boots the app in-process and exercises the
// bulk-cancel repo method, the reset service, and the endpoint. Each test creates
// its own unique users and asserts on them by id; shared seed prices (AAPL=195,
// MSFT=430, TSLA=250) are restored if mutated. Schema via `npm run db:reset`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');
const orderRepository = require('../src/repositories/order.repository');
const marketPriceRepository = require('../src/repositories/marketPrice.repository');

let server;
let base;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});

const tag = () => `${process.pid}_${process.hrtime.bigint().toString(36)}`;

async function apiJson(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

async function registerUser() {
  const t = tag();
  const r = await apiJson('POST', '/api/users', { username: `rst_${t}`, email: `rst_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function marketBuy(userId, symbol, quantity) {
  const r = await apiJson('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });
  assert.equal(r.status, 201, `buy: ${JSON.stringify(r.body)}`);
}

async function placeLimit(userId, symbol, side, quantity, targetPrice) {
  const r = await apiJson('POST', '/api/orders', {
    userId, symbol, side, quantity, orderType: 'LIMIT', targetPrice,
  });
  assert.equal(r.status, 201, `limit: ${JSON.stringify(r.body)}`);
  return r.body.data.order.id; // LIMIT response nests the order under data.order
}

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}
async function setPrice(symbol, price) {
  await marketPriceRepository.upsertLatest(await assetIdOf(symbol), price);
}
async function deletePrice(symbol) {
  await pool.query('DELETE FROM market_prices WHERE asset_id = $1', [await assetIdOf(symbol)]);
}

test('orderRepository.cancelAllPendingByUser: cancels only this user\'s PENDING orders', async () => {
  const user = await registerUser();
  const other = await registerUser();
  // Two far-from-market PENDING limits for `user` (BUY below market never crosses).
  await placeLimit(user, 'AAPL', 'BUY', 1, '1.0000');
  await placeLimit(user, 'MSFT', 'BUY', 1, '1.0000');
  // One PENDING limit for `other` — must be untouched.
  const otherOrder = await placeLimit(other, 'AAPL', 'BUY', 1, '1.0000');

  const cancelled = await orderRepository.cancelAllPendingByUser(user);
  assert.equal(cancelled.length, 2, 'both of user\'s pending orders cancelled');

  const mine = await orderRepository.listByUser(user);
  assert.ok(mine.every((o) => o.status === 'CANCELLED'), 'no pending left for user');
  const theirs = await orderRepository.listByUser(other);
  assert.equal(theirs.find((o) => o.id === otherOrder).status, 'PENDING', 'other user untouched');

  // Idempotent: second call cancels nothing.
  const again = await orderRepository.cancelAllPendingByUser(user);
  assert.equal(again.length, 0, 'no-op on already-clean');
});
