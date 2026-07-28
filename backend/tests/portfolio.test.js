'use strict';

// Portfolio valuation suite (Step 5). Boots the app in-process and drives the
// /positions and /portfolio endpoints over HTTP. Verifies live valuation, P/L,
// ROI, totals reconciliation, unpriced-asset handling and error paths.
//
//   node --test "tests/**/*.test.js"
//
// Assumes schema initialized + seed prices AAPL=195, MSFT=430, TSLA=250.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Decimal = require('decimal.js');

const app = require('../src/app');
const pool = require('../src/config/database');

const START = '100000';

let server;
let base;
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
    /* empty */
  }
  return { status: res.status, body: json };
}

const emailService = require('../src/services/email.service');
const { mock } = require('node:test');

async function registerUser(label) {
  const uniq = `${label}_${runTag}_${userSeq++}`;
  const email = `${uniq}@test.com`;
  const body = { username: uniq, email, password: 'password123', fullName: `${label} User` };
  
  let capturedCode = null;
  mock.method(emailService, 'sendRegistrationOtp', async (opts) => {
    if (opts.email === email) capturedCode = opts.code;
    return Promise.resolve();
  });

  const reqOtp = await api('POST', '/api/auth/request-registration-otp', body);
  emailService.sendRegistrationOtp.mock.restore();
  assert.equal(reqOtp.status, 202);

  const r = await api('POST', '/api/auth/register', { email, code: capturedCode });
  assert.equal(r.status, 201, `register ${label}: ${JSON.stringify(r.body)}`);
  return r.body.data.user.id;
}

const buy = (userId, symbol, quantity) =>
  api('POST', '/api/orders', { userId, symbol, side: 'BUY', quantity });

const portfolio = (userId) => api('GET', `/api/users/${userId}/portfolio`);
const positions = (userId) => api('GET', `/api/users/${userId}/positions`);

const eq = (a, b) => new Decimal(a).eq(b);

// Directly set a market price (no ingestion endpoint until Step 6). Upserts so it
// restores a row even if a prior test deleted it.
async function setPrice(symbol, price) {
  await pool.query(
    `INSERT INTO market_prices (asset_id, price)
     SELECT id, $2 FROM assets WHERE symbol = $1
     ON CONFLICT (asset_id)
     DO UPDATE SET price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP`,
    [symbol, price]
  );
}

// Restore default seed prices so tests are order-independent.
async function resetPrices() {
  await setPrice('AAPL', '195');
  await setPrice('MSFT', '430');
  await setPrice('TSLA', '250');
}

// ===========================================================================
test('empty portfolio: equity == cash == starting capital, ROI 0', async () => {
  const u = await registerUser('pf_empty');

  const pos = await positions(u);
  assert.equal(pos.status, 200);
  assert.equal(pos.body.results, 0);
  assert.deepEqual(pos.body.data, []);

  const pf = await portfolio(u);
  assert.equal(pf.status, 200);
  assert.ok(eq(pf.body.data.cashBalance, START));
  assert.ok(eq(pf.body.data.holdingsValue, '0'));
  assert.ok(eq(pf.body.data.totalEquity, START));
  assert.ok(eq(pf.body.data.roiPct, '0'));
  assert.deepEqual(pf.body.data.unpricedSymbols, []);
});

// ===========================================================================
test('after buy at seed price: P/L zero, equity unchanged', async () => {
  await resetPrices();
  const u = await registerUser('pf_buy');

  await buy(u, 'AAPL', 10); // cash 98050, holding 10 @195

  const pos = await positions(u);
  assert.equal(pos.body.results, 1);
  const h = pos.body.data[0];
  assert.equal(h.symbol, 'AAPL');
  assert.ok(eq(h.quantity, '10'));
  assert.ok(eq(h.marketValue, '1950'));
  assert.ok(eq(h.costBasis, '1950'));
  assert.ok(eq(h.unrealizedPnl, '0'));

  const pf = (await portfolio(u)).body.data;
  assert.ok(eq(pf.cashBalance, '98050'));
  assert.ok(eq(pf.holdingsValue, '1950'));
  assert.ok(eq(pf.totalEquity, START)); // 98050 + 1950
  assert.ok(eq(pf.totalUnrealizedPnl, '0'));
  assert.ok(eq(pf.roiPct, '0'));
});

// ===========================================================================
test('price move drives unrealized P/L and ROI', async () => {
  await resetPrices();
  const u = await registerUser('pf_pnl');

  await buy(u, 'AAPL', 10); // cost 1950, cash 98050
  await setPrice('AAPL', '210'); // +15/share => +150 on 10 shares

  const h = (await positions(u)).body.data[0];
  assert.ok(eq(h.currentPrice, '210'));
  assert.ok(eq(h.marketValue, '2100'));
  assert.ok(eq(h.unrealizedPnl, '150'));
  // 150 / 1950 * 100 = 7.6923 (4dp)
  assert.equal(h.unrealizedPnlPct, new Decimal(150).div(1950).times(100).toFixed(4));

  const pf = (await portfolio(u)).body.data;
  assert.ok(eq(pf.holdingsValue, '2100'));
  assert.ok(eq(pf.totalEquity, '100150')); // 98050 + 2100
  assert.ok(eq(pf.totalUnrealizedPnl, '150'));
  // ROI = (100150 - 100000)/100000 * 100 = 0.15
  assert.ok(eq(pf.roiPct, '0.15'));

  await resetPrices(); // leave prices clean for other tests
});

// ===========================================================================
test('multi-stock totals reconcile: sum(marketValue) + cash == equity', async () => {
  await resetPrices();
  const u = await registerUser('pf_multi');

  await buy(u, 'AAPL', 4); // 780
  await buy(u, 'MSFT', 2); // 860
  await buy(u, 'TSLA', 3); // 750  -> cash 100000 - 2390 = 97610

  const pf = (await portfolio(u)).body.data;

  let sum = new Decimal(0);
  for (const p of pf.positions) sum = sum.plus(p.marketValue);
  assert.ok(eq(sum, pf.holdingsValue), 'holdingsValue == sum of marketValue');
  assert.ok(
    eq(new Decimal(pf.cashBalance).plus(pf.holdingsValue), pf.totalEquity),
    'cash + holdings == equity'
  );
  // No price moved, so equity must still equal starting capital.
  assert.ok(eq(pf.totalEquity, START));
});

// ===========================================================================
test('unpriced asset: listed but excluded from totals', async () => {
  await resetPrices();
  const u = await registerUser('pf_unpriced');

  await buy(u, 'AAPL', 5); // 975, cash 99025
  // Remove TSLA's price, then give the user a TSLA holding directly (can't BUY
  // an unpriced asset — the order engine would reject it).
  await pool.query(
    `DELETE FROM market_prices m USING assets a
     WHERE a.id = m.asset_id AND a.symbol = 'TSLA'`
  );
  await pool.query(
    `INSERT INTO positions (user_id, asset_id, quantity, average_buy_price)
     SELECT $1, id, 2, 250 FROM assets WHERE symbol = 'TSLA'`,
    [u]
  );

  const pf = (await portfolio(u)).body.data;
  assert.deepEqual(pf.unpricedSymbols, ['TSLA']);

  const tsla = pf.positions.find((p) => p.symbol === 'TSLA');
  assert.equal(tsla.currentPrice, null);
  assert.equal(tsla.marketValue, null);

  // Totals include only AAPL (priced): holdings 975, equity 99025 + 975 = 100000
  assert.ok(eq(pf.holdingsValue, '975'));
  assert.ok(eq(pf.totalEquity, START));

  await resetPrices(); // restore TSLA price for other tests
});

// ===========================================================================
test('error paths: nonexistent user 404, malformed id 400', async () => {
  assert.equal((await portfolio('00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await positions('00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await portfolio('not-a-uuid')).status, 400);
  assert.equal((await positions('not-a-uuid')).status, 400);
});
