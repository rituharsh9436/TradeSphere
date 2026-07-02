'use strict';

// Step 8 — leaderboard. Boots the app in-process and exercises the ranking
// repository, service and endpoint. The leaderboard is global, so tests assert
// RELATIVE order among their own users (found by id) and restore any seed prices
// they mutate (AAPL=195, MSFT=430, TSLA=250). Schema via `npm run db:reset`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');
const leaderboardRepository = require('../src/repositories/leaderboard.repository');
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
  const r = await apiJson('POST', '/api/users', { username: `lb_${t}`, email: `lb_${t}@test.com` });
  assert.equal(r.status, 201, `register: ${JSON.stringify(r.body)}`);
  return r.body.data.id;
}

async function buy(userId, symbol, quantity) {
  const r = await apiJson('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });
  assert.equal(r.status, 201, `buy: ${JSON.stringify(r.body)}`);
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

test('leaderboard.repository: ranks by equity desc, flags unpriced holdings', async () => {
  const winner = await registerUser();
  await buy(winner, 'AAPL', 10); // cost 1950 @195 -> cash 98050
  const flat = await registerUser(); // cash only, 100000

  await setPrice('AAPL', '300.0000'); // winner holdings 3000 -> equity 101050
  const rows = await leaderboardRepository.findRankedByEquity(200);
  const w = rows.find((r) => r.id === winner);
  const f = rows.find((r) => r.id === flat);
  assert.ok(w && f, 'both users present');
  assert.ok(rows.indexOf(w) < rows.indexOf(f), 'winner ranks above cash-only');
  assert.equal(Number(w.holdings_value), 3000);
  assert.equal(w.has_unpriced, false);
  await setPrice('AAPL', '195.0000'); // restore

  // Unpriced: hold TSLA then remove its price row.
  const orphan = await registerUser();
  await buy(orphan, 'TSLA', 1); // needs price at buy time (250)
  await deletePrice('TSLA');
  const rows2 = await leaderboardRepository.findRankedByEquity(200);
  const o = rows2.find((r) => r.id === orphan);
  assert.equal(o.has_unpriced, true);
  assert.equal(Number(o.holdings_value), 0, 'unpriced holding excluded from value');
  await setPrice('TSLA', '250.0000'); // restore
});

const leaderboardService = require('../src/services/leaderboard.service');

async function rejectsWith(fn, statusCode) {
  try {
    await fn();
    assert.fail('expected rejection');
  } catch (err) {
    assert.equal(err.statusCode, statusCode, err.message);
  }
}

test('leaderboard.service.getLeaderboard: rejects bad limit before DB', async () => {
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '0' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: 'abc' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '999' }), 400);
  await rejectsWith(() => leaderboardService.getLeaderboard({ limit: '1.5' }), 400);
});

test('leaderboard.service.getLeaderboard: shapes rank, equity, ROI, unpriced flag', async () => {
  const winner = await registerUser();
  await buy(winner, 'AAPL', 10); // @195 -> cash 98050
  const flat = await registerUser(); // cash 100000
  const loser = await registerUser();
  await buy(loser, 'MSFT', 10); // @430 -> cash 95700

  await setPrice('AAPL', '300.0000'); // winner holdings 3000 -> equity 101050
  await setPrice('MSFT', '300.0000'); // loser holdings 3000 -> equity 98700

  const board = await leaderboardService.getLeaderboard({ limit: 200 });
  const w = board.find((e) => e.userId === winner);
  const f = board.find((e) => e.userId === flat);
  const l = board.find((e) => e.userId === loser);

  assert.equal(w.totalEquity, '101050.0000');
  assert.equal(w.roiPct, '1.0500');
  assert.equal(w.hasUnpricedHoldings, false);
  assert.equal(f.totalEquity, '100000.0000');
  assert.equal(f.roiPct, '0.0000');
  assert.equal(l.totalEquity, '98700.0000');
  assert.equal(l.roiPct, '-1.3000');

  // Relative ranks: winner < flat < loser.
  assert.ok(w.rank < f.rank && f.rank < l.rank, `${w.rank} < ${f.rank} < ${l.rank}`);
  // Ranks are 1-based and strictly increasing down the returned list.
  assert.equal(board[0].rank, 1);
  assert.equal(board[board.length - 1].rank, board.length);

  await setPrice('AAPL', '195.0000');
  await setPrice('MSFT', '430.0000');
});
