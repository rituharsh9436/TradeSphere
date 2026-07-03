'use strict';

// Step 10 — authentication. Unit-tests the crypto utilities, then boots the app
// in-process to exercise register/login, requireAuth, and the token-scoped
// /api/me/* surface. Each test registers its own unique user. Schema via
// `npm run db:reset`; seed prices AAPL=195, MSFT=430, TSLA=250.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');

const { hashPassword, verifyPassword } = require('../src/utils/password');
const { signToken, verifyToken } = require('../src/utils/token');

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

async function api(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

test('password.js: hashes, verifies, and rejects wrong/malformed', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.notEqual(hash, 'correct horse battery');
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('token.js: sign/verify round-trip, tamper + expiry rejected', async () => {
  const token = signToken({ sub: 'user-123' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'user-123');
  assert.ok(payload.iat && payload.exp && payload.exp > payload.iat);

  // Tamper with the payload segment.
  const [h, , s] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url')}.${s}`;
  assert.throws(() => verifyToken(forged), (e) => e.statusCode === 401);

  // Already-expired token.
  const expired = signToken({ sub: 'u' }, { expiresInSec: -10 });
  assert.throws(() => verifyToken(expired), (e) => e.statusCode === 401);

  assert.throws(() => verifyToken('not.a.jwt'), (e) => e.statusCode === 401);
});

const userRepository = require('../src/repositories/user.repository');

test('userRepository: stores password_hash and exposes it only via findAuthByEmail', async () => {
  const t = tag();
  const email = `repo_${t}@test.com`;
  const created = await userRepository.create({
    username: `repo_${t}`, email, passwordHash: 'scrypt$aa$bb',
  });
  assert.ok(created.id);
  assert.equal('password_hash' in created, false, 'create() does not leak the hash');

  const plain = await userRepository.findById(created.id);
  assert.equal('password_hash' in plain, false, 'findById is hash-free');

  const auth = await userRepository.findAuthByEmail(email);
  assert.equal(auth.password_hash, 'scrypt$aa$bb');
  assert.equal(auth.id, created.id);

  assert.equal(await userRepository.findAuthByEmail(`nope_${t}@test.com`), null);
});

async function register(overrides = {}) {
  const t = tag();
  const body = {
    username: `au_${t}`, email: `au_${t}@test.com`, password: 'password123', ...overrides,
  };
  return api('POST', '/api/auth/register', body);
}

test('POST /api/auth/register: creates user + wallet, returns token, no hash leak', async () => {
  const r = await register();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.data.token, 'returns a token');
  assert.ok(r.body.data.user.id);
  assert.equal('password_hash' in r.body.data.user, false);

  // Token is usable and identifies the new user.
  const me = await api('GET', '/api/me', null, r.body.data.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.id, r.body.data.user.id);

  // Wallet was provisioned at the starting balance.
  const wallet = await api('GET', '/api/me/wallet', null, r.body.data.token);
  assert.equal(wallet.body.data.balance, '100000.0000');
});

test('POST /api/auth/register: validation + duplicate email', async () => {
  assert.equal((await register({ password: 'short' })).status, 400);
  assert.equal((await register({ password: undefined })).status, 400);

  const first = await register();
  const dupEmail = first.body.data.user.email;
  const dup = await api('POST', '/api/auth/register', {
    username: `other_${tag()}`, email: dupEmail, password: 'password123',
  });
  assert.equal(dup.status, 409);
});

test('POST /api/auth/login: valid creds, wrong password, unknown email', async () => {
  const created = await register();
  const email = created.body.data.user.email;

  const ok = await api('POST', '/api/auth/login', { email, password: 'password123' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.data.token);

  const wrong = await api('POST', '/api/auth/login', { email, password: 'nope' });
  assert.equal(wrong.status, 401);

  const unknown = await api('POST', '/api/auth/login', { email: `ghost_${tag()}@x.com`, password: 'password123' });
  assert.equal(unknown.status, 401);
});

test('login: legacy user with NULL password_hash cannot log in', async () => {
  const t = tag();
  const legacy = await api('POST', '/api/users', { username: `legacy_${t}`, email: `legacy_${t}@test.com` });
  assert.equal(legacy.status, 201);
  const attempt = await api('POST', '/api/auth/login', { email: `legacy_${t}@test.com`, password: 'anything123' });
  assert.equal(attempt.status, 401);
});

test('requireAuth: rejects missing / malformed / garbage tokens', async () => {
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('GET', '/api/me', null, 'not-a-token')).status, 401);
  const bad = await fetch(base + '/api/me', { headers: { Authorization: 'Basic xyz' } });
  assert.equal(bad.status, 401);
});

test('/api/me/* is scoped to the token user (isolation between two users)', async () => {
  const a = (await register()).body.data.token;
  const b = (await register()).body.data.token;

  // User A buys; user B does not.
  const buy = await api('POST', '/api/me/orders', { symbol: 'AAPL', side: 'BUY', quantity: 2 }, a);
  assert.equal(buy.status, 201, JSON.stringify(buy.body));

  const aPos = await api('GET', '/api/me/positions', null, a);
  assert.equal(aPos.body.data.find((p) => p.symbol === 'AAPL').quantity, '2.0000');

  const bPos = await api('GET', '/api/me/positions', null, b);
  assert.equal(bPos.body.data.length, 0, 'user B sees none of A\'s positions');

  // Portfolio + orders read for A.
  const port = await api('GET', '/api/me/portfolio', null, a);
  assert.equal(port.status, 200);
  const orders = await api('GET', '/api/me/orders', null, a);
  assert.ok(orders.body.data.some((o) => o.symbol === 'AAPL' && o.status === 'FILLED'));
});

test('/api/me/orders supports LIMIT + cancel; /api/me/reset restores account', async () => {
  const token = (await register()).body.data.token;

  const limit = await api('POST', '/api/me/orders',
    { symbol: 'MSFT', side: 'BUY', quantity: 1, orderType: 'LIMIT', targetPrice: '1.0000' }, token);
  assert.equal(limit.status, 201);
  const orderId = limit.body.data.order.id;

  const cancel = await api('DELETE', `/api/me/orders/${orderId}`, null, token);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.status, 'CANCELLED');

  await api('POST', '/api/me/orders', { symbol: 'AAPL', side: 'BUY', quantity: 3 }, token);
  const reset = await api('POST', '/api/me/reset', null, token);
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.wallet.balance, '100000.0000');
  const after = await api('GET', '/api/me/positions', null, token);
  assert.equal(after.body.data.length, 0);
});
