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

const resetService = require('../src/services/reset.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const positionRepository = require('../src/repositories/position.repository');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('resetService.resetAccount: unknown user -> 404', async () => {
  await rejectsWith(
    () => resetService.resetAccount({ userId: '00000000-0000-0000-0000-000000000000' }),
    404
  );
});

test('resetService.resetAccount: liquidates positions, cancels orders, restores wallet, preserves ledger', async () => {
  const user = await registerUser();
  await marketBuy(user, 'AAPL', 10); // @195 -> cash 98050, position 10 @195
  await marketBuy(user, 'MSFT', 2);  // @430 -> cash 97190, position 2 @430
  await placeLimit(user, 'TSLA', 'BUY', 1, '1.0000'); // resting PENDING

  const ledgerBefore = await transactionRepository.listByUser(user);
  const buysBefore = ledgerBefore.filter((t) => t.transaction_type === 'BUY').length;
  assert.equal(buysBefore, 2, 'two BUY rows recorded pre-reset');

  const result = await resetService.resetAccount({ userId: user });

  assert.equal(result.positionsLiquidated, 2);
  assert.equal(result.ordersCancelled, 1);
  assert.equal(result.wallet.balance, '100000.0000', 'wallet restored to starting balance');

  // Positions all zeroed (findByUser filters qty > 0).
  const positions = await positionRepository.findByUser(user);
  assert.equal(positions.length, 0, 'no open positions remain');

  // No pending orders remain.
  const orders = await orderRepository.listByUser(user);
  assert.ok(orders.every((o) => o.status !== 'PENDING'), 'no pending orders remain');

  // Audit trail preserved + RESET rows appended (one per liquidated position).
  const ledgerAfter = await transactionRepository.listByUser(user);
  assert.equal(
    ledgerAfter.filter((t) => t.transaction_type === 'BUY').length,
    buysBefore,
    'original BUY rows still present'
  );
  const resets = ledgerAfter.filter((t) => t.transaction_type === 'RESET');
  assert.equal(resets.length, 2, 'one RESET row per liquidated position');
  assert.ok(resets.every((t) => t.order_id === null), 'RESET rows carry no order_id');
  // AAPL 10 @195 = 1950 ; MSFT 2 @430 = 860.
  const amounts = resets.map((t) => t.amount).sort();
  assert.deepEqual(amounts, ['1950.0000', '860.0000'].sort());
});

test('resetService.resetAccount: values unpriced holdings at average_buy_price', async () => {
  const user = await registerUser();
  await marketBuy(user, 'TSLA', 3); // @250 -> position 3 @250
  await deletePrice('TSLA');        // feed goes quiet: no market price

  const result = await resetService.resetAccount({ userId: user });
  await setPrice('TSLA', '250.0000'); // restore shared seed price

  assert.equal(result.positionsLiquidated, 1);
  const reset = result.resetTransactions[0];
  assert.equal(reset.price_per_share, '250.0000', 'fell back to average_buy_price');
  assert.equal(reset.amount, '750.0000', '3 x 250');
  assert.equal(result.wallet.balance, '100000.0000');
});

test('resetService.resetAccount: no-op on a clean account', async () => {
  const user = await registerUser(); // fresh: cash 100k, no positions/orders
  const result = await resetService.resetAccount({ userId: user });
  assert.equal(result.positionsLiquidated, 0);
  assert.equal(result.ordersCancelled, 0);
  assert.equal(result.resetTransactions.length, 0, 'no RESET rows written when nothing to liquidate');
  assert.equal(result.wallet.balance, '100000.0000');

  const ledger = await transactionRepository.listByUser(user);
  assert.equal(ledger.filter((t) => t.transaction_type === 'RESET').length, 0);
});
