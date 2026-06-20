'use strict';

// End-to-end scenario + edge-case suite for the trading engine.
// Boots the Express app in-process on an ephemeral port and drives it over HTTP,
// exactly like a real client. Uses Node's built-in test runner (no deps):
//
//   node --test tests/
//
// Assumes the schema is initialized and assets seeded (npm run db:init) with the
// default seed prices: AAPL=195, MSFT=430, TSLA=250.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Decimal = require('decimal.js');

const app = require('../src/app');
const pool = require('../src/config/database');

const PRICES = { AAPL: '195', MSFT: '430', TSLA: '250' };
const START_BALANCE = '100000';

let server;
let base;
// Unique-ish suffix so the suite is rerunnable without email collisions.
const runTag = `${process.pid}_${process.hrtime.bigint().toString(36)}`;
let userSeq = 0;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ---- HTTP helper -----------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}

async function registerUser(label) {
  const email = `${label}_${runTag}_${userSeq++}@test.com`;
  const r = await api('POST', '/api/users', { username: label, email });
  assert.equal(r.status, 201, `register ${label}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.data.wallet.balance, new Decimal(START_BALANCE).toFixed(4));
  return r.body.data.id;
}

const buy = (userId, symbol, quantity) =>
  api('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });
const sell = (userId, symbol, quantity) =>
  api('POST', '/api/orders', { userId, symbol, side: 'SELL', quantity });

async function getBalance(userId) {
  const r = await api('GET', `/api/users/${userId}/wallet`);
  assert.equal(r.status, 200);
  return r.body.data.balance;
}

// Reads positions straight from the DB (no positions API yet) for verification.
async function getPosition(userId, symbol) {
  const { rows } = await pool.query(
    `SELECT p.quantity FROM positions p
     JOIN assets a ON a.id = p.asset_id
     WHERE p.user_id = $1 AND a.symbol = $2`,
    [userId, symbol]
  );
  return rows[0] ? rows[0].quantity : null;
}

const eq = (a, b) => new Decimal(a).eq(b);

// ===========================================================================
// 1. Registration edge cases
// ===========================================================================
test('registration: duplicate email rejected (409), missing fields (400)', async () => {
  const email = `dup_${runTag}@test.com`;
  const first = await api('POST', '/api/users', { username: 'dup', email });
  assert.equal(first.status, 201);

  const dup = await api('POST', '/api/users', { username: 'dup2', email });
  assert.equal(dup.status, 409);

  const noEmail = await api('POST', '/api/users', { username: 'x' });
  assert.equal(noEmail.status, 400);

  const empty = await api('POST', '/api/users', {});
  assert.equal(empty.status, 400);
});

// ===========================================================================
// 2. Sequential multi-stock buys
// ===========================================================================
test('sequential buys across multiple stocks debit the wallet exactly', async () => {
  const u = await registerUser('seq_buyer');

  const steps = [
    ['AAPL', 10, '1950'],
    ['MSFT', 5, '2150'],
    ['TSLA', 8, '2000'],
  ];
  let expected = new Decimal(START_BALANCE);
  for (const [sym, qty, cost] of steps) {
    const r = await buy(u, sym, qty);
    assert.equal(r.status, 201, `buy ${sym}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.data.order.status, 'FILLED');
    assert.ok(eq(r.body.data.totalAmount, cost));
    expected = expected.minus(cost);
    assert.ok(eq(r.body.data.wallet.balance, expected), `balance after ${sym}`);
  }
  // balance: 100000 - 1950 - 2150 - 2000 = 93900
  assert.ok(eq(await getBalance(u), '93900'));
  assert.ok(eq(await getPosition(u, 'AAPL'), '10'));
  assert.ok(eq(await getPosition(u, 'MSFT'), '5'));
  assert.ok(eq(await getPosition(u, 'TSLA'), '8'));
});

// ===========================================================================
// 3. Sequential mixed buy/sell, incl. average-price math and full liquidation
// ===========================================================================
test('mixed buy/sell sequence keeps balance, quantity and avg price correct', async () => {
  const u = await registerUser('seq_mixed');

  await buy(u, 'AAPL', 10); // 1950 -> 98050, AAPL 10 @195
  await buy(u, 'MSFT', 5); //  2150 -> 95900, MSFT 5  @430
  await buy(u, 'TSLA', 8); //  2000 -> 93900, TSLA 8  @250

  const s1 = await sell(u, 'AAPL', 4); // +780 -> 94680, AAPL 6
  assert.equal(s1.status, 201);
  assert.ok(eq(s1.body.data.wallet.balance, '94680'));

  const b2 = await buy(u, 'MSFT', 2); // 860 -> 93820, MSFT 7 (avg still 430)
  assert.equal(b2.status, 201);
  assert.ok(eq(b2.body.data.wallet.balance, '93820'));

  const s2 = await sell(u, 'TSLA', 8); // +2000 -> 95820, TSLA 0
  assert.equal(s2.status, 201);
  assert.ok(eq(s2.body.data.wallet.balance, '95820'));

  assert.ok(eq(await getPosition(u, 'AAPL'), '6'));
  assert.ok(eq(await getPosition(u, 'MSFT'), '7'));
  // avg buy price for MSFT must remain 430 (sell doesn't change it; both buys @430)
  const { rows } = await pool.query(
    `SELECT p.average_buy_price FROM positions p JOIN assets a ON a.id=p.asset_id
     WHERE p.user_id=$1 AND a.symbol='MSFT'`,
    [u]
  );
  assert.ok(eq(rows[0].average_buy_price, '430'));
  assert.ok(eq(await getPosition(u, 'TSLA'), '0'));
});

// ===========================================================================
// 4. Parallel independent buys — no lost updates (wallet must end exact)
// ===========================================================================
test('parallel buys on different stocks do not lose updates', async () => {
  const u = await registerUser('par_indep');

  // 50 concurrent buys: mix of AAPL/MSFT/TSLA, all affordable together.
  const plan = [];
  for (let i = 0; i < 50; i++) {
    const sym = ['AAPL', 'MSFT', 'TSLA'][i % 3];
    plan.push(sym);
  }
  const results = await Promise.all(plan.map((sym) => buy(u, sym, 1)));
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));

  // Expected debit = sum of each leg's price.
  let debit = new Decimal(0);
  for (const sym of plan) debit = debit.plus(PRICES[sym]);
  const expected = new Decimal(START_BALANCE).minus(debit);

  assert.ok(eq(await getBalance(u), expected), 'balance must equal exact sum (no lost update)');
});

// ===========================================================================
// 5. Order placement edge cases
// ===========================================================================
test('order edge cases: funds, holdings, symbol, quantity, ids', async () => {
  const u = await registerUser('edge');

  // Insufficient funds (1000 * 430 = 430000 > 100000)
  assert.equal((await buy(u, 'MSFT', 1000)).status, 422);

  // Sell with no position
  assert.equal((await sell(u, 'TSLA', 1)).status, 422);

  // Buy a little, then oversell
  assert.equal((await buy(u, 'AAPL', 2)).status, 201);
  assert.equal((await sell(u, 'AAPL', 3)).status, 422);

  // Unknown symbol
  assert.equal((await buy(u, 'ZZZZ', 1)).status, 404);

  // Bad quantities
  assert.equal((await buy(u, 'AAPL', 0)).status, 400);
  assert.equal((await buy(u, 'AAPL', -5)).status, 400);
  assert.equal((await buy(u, 'AAPL', 'abc')).status, 400);

  // Missing fields
  assert.equal((await api('POST', '/api/orders', { userId: u, symbol: 'AAPL' })).status, 400);

  // Malformed UUID -> 400, valid-but-nonexistent UUID -> 404
  assert.equal((await buy('not-a-uuid', 'AAPL', 1)).status, 400);
  assert.equal(
    (await buy('00000000-0000-0000-0000-000000000000', 'AAPL', 1)).status,
    404
  );
});

// ===========================================================================
// 6. Fractional-share precision (DECIMAL 15,4)
// ===========================================================================
test('fractional-share order computes exact decimal amount', async () => {
  const u = await registerUser('frac');

  // 2.5 AAPL @195 = 487.50
  const r = await buy(u, 'AAPL', 2.5);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(eq(r.body.data.totalAmount, '487.5'));
  assert.ok(eq(r.body.data.wallet.balance, '99512.5'));
  assert.ok(eq(await getPosition(u, 'AAPL'), '2.5'));
});

// ===========================================================================
// 7. Concurrency: overdraft protection must serialize on the wallet lock
// ===========================================================================
test('parallel overdraft: exactly floor(balance/price) fills, never negative', async () => {
  const u = await registerUser('overdraft');
  // balance 100000, each buy = 1 MSFT @430. Capacity = floor(100000/430) = 232.
  const fired = 260; // more than capacity, to test the cap
  const capacity = Math.floor(100000 / 430); // 232

  const results = await Promise.all(
    Array.from({ length: fired }, () => buy(u, 'MSFT', 1))
  );
  const filled = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 422).length;

  assert.equal(filled, capacity, 'exactly capacity orders should fill');
  assert.equal(filled + rejected, fired, 'every order is either filled or 422');

  const finalBalance = await getBalance(u);
  assert.ok(new Decimal(finalBalance).gte(0), 'balance must never go negative');
  // 100000 - 232*430 = 260
  assert.ok(eq(finalBalance, new Decimal(100000).minus(new Decimal(capacity).times(430))));
  assert.ok(eq(await getPosition(u, 'MSFT'), String(capacity)));
});

// ===========================================================================
// 8. Concurrency: oversell protection on a single holding
// ===========================================================================
test('parallel oversell: position never goes negative', async () => {
  const u = await registerUser('oversell');
  assert.equal((await buy(u, 'AAPL', 7)).status, 201); // hold 7

  // Fire 5 concurrent SELL 4 — only one can succeed (7 -> 3); rest 422.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => sell(u, 'AAPL', 4))
  );
  const filled = results.filter((r) => r.status === 201).length;
  assert.equal(filled, 1, 'only one oversell-sized order may fill');

  const pos = await getPosition(u, 'AAPL');
  assert.ok(new Decimal(pos).gte(0), 'position must never be negative');
  assert.ok(eq(pos, '3'), 'remaining position should be 3');
});

// ===========================================================================
// 9. Reconciliation: wallet must equal start - buys + sells from the ledger
// ===========================================================================
test('ledger reconciles with wallet balance and positions', async () => {
  const u = await registerUser('reconcile');

  await buy(u, 'AAPL', 10);
  await buy(u, 'MSFT', 3);
  await sell(u, 'AAPL', 4);
  await buy(u, 'TSLA', 2);
  await sell(u, 'MSFT', 1);

  // Recompute expected balance from the immutable ledger itself.
  const { rows } = await pool.query(
    `SELECT transaction_type, amount FROM transactions WHERE user_id = $1`,
    [u]
  );
  let expected = new Decimal(START_BALANCE);
  for (const t of rows) {
    expected =
      t.transaction_type === 'BUY' ? expected.minus(t.amount) : expected.plus(t.amount);
  }
  assert.ok(eq(await getBalance(u), expected), 'wallet must match ledger sum');

  // Net positions: AAPL 6, MSFT 2, TSLA 2
  assert.ok(eq(await getPosition(u, 'AAPL'), '6'));
  assert.ok(eq(await getPosition(u, 'MSFT'), '2'));
  assert.ok(eq(await getPosition(u, 'TSLA'), '2'));
});
