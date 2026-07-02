'use strict';

// Step 7 — limit orders. Boots the app in-process and exercises the limit-order
// repository, placement, matcher and cancel. Assumes schema via `npm run db:reset`
// (seed AAPL=195). Order-independent: unique users per test; restores AAPL price.

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
  const r = await apiJson('POST', '/api/users', { username: `lim_${t}`, email: `lim_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function assetIdOf(symbol) {
  const { rows } = await pool.query('SELECT id FROM assets WHERE symbol = $1', [symbol]);
  return rows[0].id;
}

test('order.repository: findPendingLimitByAsset + findByIdForUpdate', async () => {
  const userId = await registerUser();
  const aaplId = await assetIdOf('AAPL');

  const created = await orderRepository.create({
    userId, assetId: aaplId, orderType: 'LIMIT', side: 'BUY',
    quantity: '3.0000', targetPrice: '190.0000', status: 'PENDING',
  });

  const pending = await orderRepository.findPendingLimitByAsset(aaplId);
  const mine = pending.find((o) => o.id === created.id);
  assert.ok(mine, 'created pending limit is listed');
  assert.equal(mine.side, 'BUY');
  assert.equal(mine.target_price, '190.0000');

  const locked = await orderRepository.findByIdForUpdate(created.id);
  assert.equal(locked.status, 'PENDING');
  assert.equal(locked.order_type, 'LIMIT');
  assert.equal(locked.user_id, userId);

  assert.equal(await orderRepository.findByIdForUpdate('00000000-0000-0000-0000-000000000000'), null);
});

test('POST /api/orders LIMIT: creates PENDING with no wallet change', async () => {
  const userId = await registerUser();

  const before = await apiJson('GET', `/api/users/${userId}/wallet`);
  const startBalance = before.body.data.balance;

  const r = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 2, orderType: 'LIMIT', targetPrice: 150,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.order.order_type, 'LIMIT');
  assert.equal(r.body.data.order.status, 'PENDING');
  assert.equal(r.body.data.order.target_price, '150.0000');

  const afterW = await apiJson('GET', `/api/users/${userId}/wallet`);
  assert.equal(afterW.body.data.balance, startBalance, 'wallet unchanged at placement');
});

test('POST /api/orders LIMIT: validation errors', async () => {
  const userId = await registerUser();
  const bad = (body) => apiJson('POST', '/api/orders', { userId, symbol: 'AAPL', ...body });

  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT' })).status, 400); // no target
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 0 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: -5 })).status, 400);
  assert.equal((await bad({ side: 'HOLD', quantity: 1, orderType: 'LIMIT', targetPrice: 10 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 0, orderType: 'LIMIT', targetPrice: 10 })).status, 400);
  assert.equal((await bad({ side: 'BUY', quantity: 1, orderType: 'FOO', targetPrice: 10 })).status, 400);
});

const orderService = require('../src/services/order.service');

// Set the shared market price for a symbol, run the matcher, then the caller
// restores the seed. getPrice (used inside fillLimitOrder) reads this row.
async function setPrice(symbol, price) {
  const id = await assetIdOf(symbol);
  await marketPriceRepository.upsertLatest(id, price);
}

async function walletBalance(userId) {
  const r = await apiJson('GET', `/api/users/${userId}/wallet`);
  return r.body.data.balance;
}

// The matcher fills ALL pending limits for a symbol, so aggregate {filled,rejected}
// counts depend on global state. Neutralize other tests' leftover AAPL limits so
// each matcher test's counts reflect only the orders it created (order-independent).
async function clearPendingLimits(symbol) {
  const id = await assetIdOf(symbol);
  await pool.query(
    `UPDATE orders SET status = 'CANCELLED'
     WHERE asset_id = $1 AND order_type = 'LIMIT' AND status = 'PENDING'`,
    [id]
  );
}

test('matcher: BUY limit fills at target when price crosses down', async () => {
  const userId = await registerUser();
  await clearPendingLimits('AAPL');
  const start = await walletBalance(userId);

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 2, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000'); // 189 <= 190 -> crosses
  const res = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(res, { filled: 1, rejected: 0 });

  const locked = await orderRepository.findByIdForUpdate(orderId);
  assert.equal(locked.status, 'FILLED');
  // Filled at target 190, qty 2 -> debit 380.
  const expected = (Number(start) - 380).toFixed(4);
  assert.equal(await walletBalance(userId), expected);

  await setPrice('AAPL', '195.0000'); // restore seed
});

test('matcher: SELL limit fills at target when price crosses up; not-crossed stays PENDING', async () => {
  const userId = await registerUser();
  await clearPendingLimits('AAPL');
  // Give the user shares: BUY 5 AAPL at market (195).
  await apiJson('POST', '/api/orders', { userId, symbol: 'AAPL', side: 'BUY', quantity: 5 });

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'SELL', quantity: 5, orderType: 'LIMIT', targetPrice: 210,
  });
  const orderId = placed.body.data.order.id;

  // Price below target -> no cross.
  await setPrice('AAPL', '200.0000');
  assert.deepEqual(
    await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '200.0000' }),
    { filled: 0, rejected: 0 }
  );
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'PENDING');

  // Price at/above target -> fills.
  await setPrice('AAPL', '210.0000');
  assert.deepEqual(
    await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '210.0000' }),
    { filled: 1, rejected: 0 }
  );
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'FILLED');

  await setPrice('AAPL', '195.0000');
});

test('matcher: insufficient funds at fill -> REJECTED, wallet unchanged', async () => {
  const userId = await registerUser();
  await clearPendingLimits('AAPL');
  const start = await walletBalance(userId); // 100000

  // Target 190, qty 1000 -> needs 190000 > 100000 at fill.
  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 1000, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000');
  const res = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(res, { filled: 0, rejected: 1 });
  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'REJECTED');
  assert.equal(await walletBalance(userId), start, 'wallet unchanged on reject');

  await setPrice('AAPL', '195.0000');
});

test('matcher: idempotent — running twice fills a crossed order once', async () => {
  const userId = await registerUser();
  await clearPendingLimits('AAPL');
  const start = await walletBalance(userId);

  const placed = await apiJson('POST', '/api/orders', {
    userId, symbol: 'AAPL', side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: 190,
  });
  const orderId = placed.body.data.order.id;

  await setPrice('AAPL', '189.0000');
  const first = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  const second = await orderService.processLimitOrdersForSymbol({ symbol: 'AAPL', price: '189.0000' });
  assert.deepEqual(first, { filled: 1, rejected: 0 });
  assert.deepEqual(second, { filled: 0, rejected: 0 }); // already FILLED -> not re-listed

  assert.equal((await orderRepository.findByIdForUpdate(orderId)).status, 'FILLED');
  const expected = (Number(start) - 190).toFixed(4); // debited once
  assert.equal(await walletBalance(userId), expected);

  await setPrice('AAPL', '195.0000');
});
