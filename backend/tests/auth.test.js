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
