# Step 10 — Authentication & accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Password-protected accounts with JWT bearer auth (built-in `crypto`, no new deps). New `/api/auth/register|login` + a token-scoped `/api/me/*` surface; retire the frontend dev "active user" bridge for a real login/register flow.

**Architecture:** Two `crypto` utilities (scrypt password hashing, HS256 token sign/verify) underpin an `auth.service` (register/login) and a `requireAuth` middleware. A `/api/me/*` router reads the user from the verified token and delegates to the existing wallet/portfolio/order/reset services. Legacy `/api/users/*` + `/api/orders` stay unauthenticated so existing tests don't regress (`password_hash` is nullable). Frontend swaps the dev bridge for `AuthContext` + login/register pages + axios token interceptors.

**Tech Stack:** Node.js (CommonJS), Express 5, PostgreSQL via `pg`, built-in `crypto`, Node test runner. Frontend: Vite + React 19, react-router v7, axios, Vitest.

## Global Constraints

- Language CommonJS (backend). Money still 4 dp via `decimal.js` (unchanged in this step).
- **No new npm dependencies.** Hashing = `crypto.scrypt`; token = `crypto` HMAC-SHA256.
- `password_hash` is **nullable**; legacy `POST /api/users` leaves it NULL (dev users can't log in). Only `POST /api/auth/register` sets it. Login treats NULL/absent hash as invalid credentials.
- Auth responses: `{ status:'success', data:{ user, token } }`; `user` never includes `password_hash`.
- Login failures are generic 401 `Invalid email or password.` (no user enumeration).
- `requireAuth` sets `req.userId` from the verified token; `/api/me/*` NEVER trusts a client-supplied userId.
- Layering `routes → controllers → services → repositories → DB`; repo methods take a trailing `client = pool`; controllers wrapped in `catchAsync`; errors via `AppError(message, statusCode)`.
- JWT secret from `process.env.JWT_SECRET`, dev fallback + one warning if unset.
- Backend tests: `npm test` from `backend/` (`node --test --test-concurrency=1 "tests/**/*.test.js"`); DB via `npm run db:reset`. New users in tests are created via `POST /api/auth/register` with a unique username/email; existing 57 tests stay green.
- Frontend: `npm run lint` + `npm run build` must pass; add one Vitest unit test. Manual login→trade check by the user.
- Run backend commands from `backend/`, frontend from `paper-trading-ui/`.

---

## File Structure

**Backend — Create:**
- `src/utils/password.js`, `src/utils/token.js`
- `src/services/auth.service.js`, `src/controllers/auth.controller.js`, `src/routes/auth.routes.js`
- `src/middleware/auth.js`
- `src/controllers/me.controller.js`, `src/routes/me.routes.js`
- `tests/auth.test.js`

**Backend — Modify:**
- `src/scripts/init-db.js` (password_hash column + ALTER)
- `src/repositories/user.repository.js` (create passwordHash + findAuthByEmail)
- `src/routes/index.js` (mount `/auth`, `/me`)
- `.env.example` (JWT_SECRET) — create if absent

**Frontend — Create:**
- `src/context/AuthContext.jsx`, `src/services/authApi.js`, `src/lib/authStorage.js`, `src/lib/authStorage.test.js`
- `src/pages/Login.jsx`, `src/pages/Register.jsx`, `src/components/RequireAuth.jsx`

**Frontend — Modify:**
- `src/services/api.js`, `src/services/marketApi.js`, `src/App.jsx`, `src/components/Navbar.jsx`, `src/components/TradePanel.jsx`, `src/pages/Dashboard.jsx`

**Frontend — Delete:**
- `src/context/ActiveUserContext.jsx`, `src/components/UserPicker.jsx`

**Docs:** `TODO.md`, `MEMORY.md`

---

### Task 1: crypto utilities — `password.js` + `token.js` (TDD)

**Files:**
- Create: `backend/src/utils/password.js`, `backend/src/utils/token.js`
- Test: `backend/tests/auth.test.js` (new)

**Interfaces:**
- `hashPassword(plain) → Promise<string>` (`scrypt$<saltHex>$<keyHex>`); `verifyPassword(plain, stored) → Promise<boolean>` (false on malformed, never throws).
- `signToken(payload, opts?) → string`; `verifyToken(token) → payload` (throws `AppError(401)` on bad/expired).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/auth.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run db:reset && npm test`
Expected: FAIL — `Cannot find module '../src/utils/password'`.

- [ ] **Step 3: Implement `password.js`**

Create `backend/src/utils/password.js`:

```js
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const SALT_BYTES = 16;

// scrypt-based password hashing using only Node's crypto. Stored format is
// `scrypt$<saltHex>$<keyHex>` so verify is self-describing. verify is
// constant-time and never throws (malformed input -> false).
async function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(String(plain), salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length !== KEYLEN) return false;
  const actual = await scrypt(String(plain), salt, KEYLEN);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 4: Implement `token.js`**

Create `backend/src/utils/token.js`:

```js
const crypto = require('crypto');
const AppError = require('./AppError');

// Minimal HS256 JWT using only Node's crypto — no jsonwebtoken dependency.
// signToken({ sub }) -> "base64url(header).base64url(payload).base64url(sig)".
const DEFAULT_TTL_SEC = 604800; // 7 days

let warned = false;
function secret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (!warned) {
    console.warn('JWT_SECRET is not set — using an insecure dev fallback. Set it in production.');
    warned = true;
  }
  return 'dev-insecure-secret-change-me';
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(headerPayloadB64) {
  return crypto.createHmac('sha256', secret()).update(headerPayloadB64).digest('base64url');
}

// nowSec is injectable so tests can build already-expired tokens deterministically
// without Date mocking (iat/exp are computed from Math.floor(Date.now()/1000)).
function signToken(payload, { expiresInSec = DEFAULT_TTL_SEC } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + expiresInSec };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = b64url(JSON.stringify(body));
  const data = `${header}.${payloadB64}`;
  return `${data}.${sign(data)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') throw new AppError('Invalid or expired token.', 401);
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('Invalid or expired token.', 401);
  const [header, payloadB64, providedSig] = parts;
  const expectedSig = sign(`${header}.${payloadB64}`);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError('Invalid or expired token.', 401);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('Invalid or expired token.', 401);
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new AppError('Invalid or expired token.', 401);
  }
  return payload;
}

module.exports = { signToken, verifyToken };
```

Note: `signToken`/`verifyToken` use `Date.now()`. Node's test runner allows this at runtime (unlike the workflow sandbox). The negative-TTL trick yields an already-expired token without any time mocking.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the two utility tests green; the rest of the suite still 57 green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/password.js backend/src/utils/token.js backend/tests/auth.test.js
git commit -m "feat(step10): scrypt password hashing + HS256 token utils"
```

---

### Task 2: schema + user repository — `password_hash`

**Files:**
- Modify: `backend/src/scripts/init-db.js`, `backend/src/repositories/user.repository.js`
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- `users.password_hash VARCHAR(255)` nullable.
- `userRepository.create({ username, email, passwordHash = null }, client)` — persists the hash; RETURNING stays hash-free.
- `userRepository.findAuthByEmail(email, client) → { id, username, email, password_hash } | null`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/auth.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `userRepository.findAuthByEmail is not a function` (and/or column error before `db:reset`).

- [ ] **Step 3: Add the column in `init-db.js`**

In `backend/src/scripts/init-db.js`, add `password_hash` to the `users` CREATE TABLE (nullable):

```sql
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
```

And, so existing databases pick up the column too, add this line inside the `schemaQuery` (e.g. right after the users table, before the wallets table — an idempotent ALTER):

```sql
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
```

- [ ] **Step 4: Extend `user.repository.js`**

Update `create` and add `findAuthByEmail`:

```js
  async create({ username, email, passwordHash = null }, client = pool) {
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );
    return rows[0];
  },
```

Add after `findByEmail`:

```js
  // Auth-only lookup: the single method that returns password_hash (for login).
  async findAuthByEmail(email, client = pool) {
    const { rows } = await client.query(
      `SELECT id, username, email, password_hash FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run db:reset && npm test`
Expected: PASS — hash stored, `findById`/`create` hash-free, `findAuthByEmail` returns it; suite still green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/init-db.js backend/src/repositories/user.repository.js backend/tests/auth.test.js
git commit -m "feat(step10): nullable password_hash column + user repo auth lookup"
```

---

### Task 3: auth service + controller + routes + `requireAuth` (TDD)

**Files:**
- Create: `backend/src/services/auth.service.js`, `backend/src/controllers/auth.controller.js`, `backend/src/routes/auth.routes.js`, `backend/src/middleware/auth.js`
- Modify: `backend/src/routes/index.js`
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- `authService.register({username,email,password}) → {user, token}`; `login({email,password}) → {user, token}`.
- Routes: `POST /api/auth/register` (201), `POST /api/auth/login` (200).
- `requireAuth(req,res,next)` sets `req.userId`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/auth.test.js`:

```js
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
  // Legacy dev-user path (no password) still works and leaves hash NULL.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/auth/register` 404 (routes not mounted).

- [ ] **Step 3: Implement `auth.service.js`**

Create `backend/src/services/auth.service.js`:

```js
const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');

const MIN_PASSWORD_LEN = 8;

const authService = {
  // Register a new account: hash the password, then create the user + wallet in
  // one transaction (a user can never exist without a wallet). Returns the
  // hash-free user plus a signed JWT.
  async register({ username, email, password }) {
    if (!username || !email) throw new AppError('username and email are required.', 400);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
      throw new AppError(`password must be at least ${MIN_PASSWORD_LEN} characters.`, 400);
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) throw new AppError('A user with this email already exists.', 409);

    const passwordHash = await hashPassword(password);
    const user = await withTransaction(async (client) => {
      const created = await userRepository.create({ username, email, passwordHash }, client);
      await walletRepository.create({ userId: created.id }, client);
      return created;
    });

    return { user, token: signToken({ sub: user.id }) };
  },

  // Verify credentials and issue a token. Failures are generic (no user
  // enumeration); a NULL password_hash (legacy dev user) can never authenticate.
  async login({ email, password }) {
    if (!email || !password) throw new AppError('email and password are required.', 400);
    const account = await userRepository.findAuthByEmail(email);
    const ok = account && account.password_hash
      ? await verifyPassword(password, account.password_hash)
      : false;
    if (!ok) throw new AppError('Invalid email or password.', 401);

    const user = { id: account.id, username: account.username, email: account.email };
    return { user, token: signToken({ sub: user.id }) };
  },
};

module.exports = authService;
```

- [ ] **Step 4: Implement `auth.controller.js`**

Create `backend/src/controllers/auth.controller.js`:

```js
const authService = require('../services/auth.service');
const catchAsync = require('../utils/catchAsync');

const authController = {
  register: catchAsync(async (req, res) => {
    const { username, email, password } = req.body;
    const result = await authService.register({ username, email, password });
    res.status(201).json({ status: 'success', data: result });
  }),

  login: catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    res.status(200).json({ status: 'success', data: result });
  }),
};

module.exports = authController;
```

- [ ] **Step 5: Implement `requireAuth` middleware**

Create `backend/src/middleware/auth.js`:

```js
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { verifyToken } = require('../utils/token');

// Gate for protected routes. Requires `Authorization: Bearer <token>`, verifies
// it, and pins the authenticated user id on the request for downstream handlers.
const requireAuth = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required.', 401);
  }
  const payload = verifyToken(token); // throws AppError(401) on bad/expired
  req.userId = payload.sub;
  next();
});

module.exports = { requireAuth };
```

- [ ] **Step 6: Implement `auth.routes.js` + mount**

Create `backend/src/routes/auth.routes.js`:

```js
const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
```

In `backend/src/routes/index.js`, require and mount (the `/me` mount is added in Task 4):

```js
const authRoutes = require('./auth.routes');
// ...
router.use('/auth', authRoutes);
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: register/login/requireAuth tests pass **except** the `/api/me` assertions inside the register test (still 404 until Task 4). If you prefer a fully-green gate here, temporarily skip the `/api/me` lines; they're implemented next. (Simplest: proceed to Task 4, then run.)

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/auth.service.js backend/src/controllers/auth.controller.js backend/src/middleware/auth.js backend/src/routes/auth.routes.js backend/src/routes/index.js backend/tests/auth.test.js
git commit -m "feat(step10): auth service, controller, routes, requireAuth middleware"
```

---

### Task 4: `/api/me/*` protected router (TDD)

**Files:**
- Create: `backend/src/controllers/me.controller.js`, `backend/src/routes/me.routes.js`
- Modify: `backend/src/routes/index.js`
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- `GET /api/me` · `/wallet` · `/positions` · `/portfolio` · `/orders` (GET list, POST place) · `DELETE /orders/:id` · `POST /reset` — all behind `requireAuth`, user = `req.userId`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/auth.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/me/orders` 404 (router not mounted).

- [ ] **Step 3: Implement `me.controller.js`**

Create `backend/src/controllers/me.controller.js`:

```js
const catchAsync = require('../utils/catchAsync');
const userService = require('../services/user.service');
const walletService = require('../services/wallet.service');
const portfolioService = require('../services/portfolio.service');
const orderService = require('../services/order.service');
const resetService = require('../services/reset.service');

// Thin adapters for the authenticated user. The user id ALWAYS comes from
// req.userId (set by requireAuth) — never from the body or params.
const meController = {
  getMe: catchAsync(async (req, res) => {
    const user = await userService.getById(req.userId);
    res.status(200).json({ status: 'success', data: { user } });
  }),

  getWallet: catchAsync(async (req, res) => {
    const wallet = await walletService.getByUserId(req.userId);
    res.status(200).json({ status: 'success', data: wallet });
  }),

  getPositions: catchAsync(async (req, res) => {
    const positions = await portfolioService.getPositions(req.userId);
    res.status(200).json({ status: 'success', results: positions.length, data: positions });
  }),

  getPortfolio: catchAsync(async (req, res) => {
    const portfolio = await portfolioService.getPortfolio(req.userId);
    res.status(200).json({ status: 'success', data: portfolio });
  }),

  listOrders: catchAsync(async (req, res) => {
    const orders = await orderService.listOrders(req.userId);
    res.status(200).json({ status: 'success', results: orders.length, data: orders });
  }),

  placeOrder: catchAsync(async (req, res) => {
    const { symbol, side, quantity, orderType, targetPrice } = req.body;
    const type = orderType ? String(orderType).toUpperCase() : 'MARKET';
    const data =
      type === 'LIMIT'
        ? { order: await orderService.placeLimitOrder({ userId: req.userId, symbol, side, quantity, targetPrice }) }
        : await orderService.placeMarketOrder({ userId: req.userId, symbol, side, quantity });
    res.status(201).json({ status: 'success', data });
  }),

  cancelOrder: catchAsync(async (req, res) => {
    const order = await orderService.cancelOrder({ orderId: req.params.id, userId: req.userId });
    res.status(200).json({ status: 'success', data: order });
  }),

  reset: catchAsync(async (req, res) => {
    const summary = await resetService.resetAccount({ userId: req.userId });
    res.status(200).json({ status: 'success', data: summary });
  }),
};

module.exports = meController;
```

Note: `placeOrder` rejects a bad `orderType` the same way the legacy controller does? The legacy controller 400s on an unknown type; here an unknown non-LIMIT type falls through to MARKET. To match legacy behaviour exactly, add the guard:

```js
    if (!['MARKET', 'LIMIT'].includes(type)) {
      throw new (require('../utils/AppError'))('orderType must be MARKET or LIMIT.', 400);
    }
```

(place this right after computing `type`).

- [ ] **Step 4: Implement `me.routes.js`**

Create `backend/src/routes/me.routes.js`:

```js
const express = require('express');
const meController = require('../controllers/me.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every /api/me route requires a valid token.
router.use(requireAuth);

router.get('/', meController.getMe);
router.get('/wallet', meController.getWallet);
router.get('/positions', meController.getPositions);
router.get('/portfolio', meController.getPortfolio);
router.get('/orders', meController.listOrders);
router.post('/orders', meController.placeOrder);
router.delete('/orders/:id', meController.cancelOrder);
router.post('/reset', meController.reset);

module.exports = router;
```

- [ ] **Step 5: Mount in `routes/index.js`**

```js
const meRoutes = require('./me.routes');
// ...
router.use('/me', meRoutes);
```

- [ ] **Step 6: Run tests**

Run: `npm run db:reset && npm test`
Expected: PASS — all auth + /api/me tests green; total suite = 57 prior + new auth tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/me.controller.js backend/src/routes/me.routes.js backend/src/routes/index.js backend/tests/auth.test.js
git commit -m "feat(step10): token-scoped /api/me/* router"
```

---

### Task 5: `.env.example` — document `JWT_SECRET`

**Files:**
- Create/Modify: `backend/.env.example`

- [ ] **Step 1: Ensure `.env.example` documents the required vars**

Create `backend/.env.example` (or add the line if it exists):

```
# PostgreSQL connection string
DATABASE_URL=postgres://user:password@localhost:5432/moneylogix

# Finnhub API key for live market ticks (optional; simulator used if absent)
FINNHUB_API_KEY=

# Secret used to sign JWT auth tokens (REQUIRED in production)
JWT_SECRET=change-me-to-a-long-random-string
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "docs(step10): document JWT_SECRET in .env.example"
```

---

### Task 6: Frontend — auth context, login/register, retire the dev bridge

> Verification for this task = `npm run lint` and `npm run build` pass, the one Vitest unit test passes, and the user manually confirms login→trade. No DOM component tests (no library installed).

**Files:** see File Structure. Work from `paper-trading-ui/`.

- [ ] **Step 1: Token storage helper + unit test (TDD)**

Create `paper-trading-ui/src/lib/authStorage.js`:

```js
// Single source of truth for the persisted auth token. Kept tiny and pure so it
// can be unit-tested and reused by both the axios interceptor and AuthContext.
const TOKEN_KEY = "mlx.token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearToken() {
  setToken(null);
}
```

Create `paper-trading-ui/src/lib/authStorage.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { getToken, setToken, clearToken } from "./authStorage";

describe("authStorage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a token", () => {
    expect(getToken()).toBe(null);
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
  });

  it("clears the token", () => {
    setToken("x");
    clearToken();
    expect(getToken()).toBe(null);
  });
});
```

Run: `npm run test` (Vitest). Expected: PASS. If Vitest's environment lacks `localStorage`, set `environment: 'jsdom'`? — the existing `marketSocket.test.js` runs under the current config; if `localStorage` is undefined, guard already returns null, but the round-trip test needs it. If it fails, add `// @vitest-environment jsdom` at the top of `authStorage.test.js` (jsdom ships with Vitest).

- [ ] **Step 2: axios interceptors in `services/api.js`**

Replace `paper-trading-ui/src/services/api.js`:

```js
import axios from "axios";
import { getToken, clearToken } from "../lib/authStorage";

// All backend routes live under /api (see backend routes/index.js).
const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

// Attach the bearer token (if any) to every request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, drop the (stale) token and bounce to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(err);
  }
);

export default api;
```

- [ ] **Step 3: `services/authApi.js`**

```js
import api from "./api";

export async function registerUser({ username, email, password }) {
  const res = await api.post("/auth/register", { username, email, password });
  return res.data.data; // { user, token }
}

export async function loginUser({ email, password }) {
  const res = await api.post("/auth/login", { email, password });
  return res.data.data; // { user, token }
}

export async function getMe() {
  const res = await api.get("/me");
  return res.data.data.user;
}
```

- [ ] **Step 4: `context/AuthContext.jsx`**

```jsx
/* eslint-disable react-refresh/only-export-components */
// Provider + hook are one cohesive unit (same pattern as the retired
// ActiveUserContext); opt out of the react-refresh export heuristic.
import { createContext, useContext, useEffect, useState } from "react";
import { getToken, setToken } from "../lib/authStorage";
import { loginUser, registerUser, getMe } from "../services/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(getToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  // Hydrate the user from a persisted token on first load.
  useEffect(() => {
    let active = true;
    if (!token) {
      setLoading(false);
      return;
    }
    getMe()
      .then((u) => active && setUser(u))
      .catch(() => active && logout())
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function persist({ user: u, token: tk }) {
    setToken(tk);
    setTokenState(tk);
    setUser(u);
  }

  async function login(credentials) {
    persist(await loginUser(credentials));
  }
  async function register(details) {
    persist(await registerUser(details));
  }
  function logout() {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 5: `pages/Login.jsx` + `pages/Register.jsx`**

`Login.jsx`:

```jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(form);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 320, margin: "60px auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <h1>Log in</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input placeholder="email" type="email" value={form.email} required
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="password" type="password" value={form.password} required
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button type="submit" disabled={busy}>Log in</button>
      </form>
      {error && <span style={{ color: "crimson" }}>{error}</span>}
      <span>No account? <Link to="/register">Register</Link></span>
    </div>
  );
}

export default Login;
```

`Register.jsx` (mirror, with username + password ≥ 8, calling `register`):

```jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(form);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 320, margin: "60px auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <h1>Register</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input placeholder="username" value={form.username} required
          onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input placeholder="email" type="email" value={form.email} required
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="password (min 8 chars)" type="password" value={form.password} required minLength={8}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button type="submit" disabled={busy}>Create account</button>
      </form>
      {error && <span style={{ color: "crimson" }}>{error}</span>}
      <span>Have an account? <Link to="/login">Log in</Link></span>
    </div>
  );
}

export default Register;
```

- [ ] **Step 6: `components/RequireAuth.jsx`**

```jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Guards app routes: redirects to /login when there is no token.
function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default RequireAuth;
```

- [ ] **Step 7: Rewrite `App.jsx`**

```jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Market from "./pages/Market";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Navbar from "./components/Navbar";
import RequireAuth from "./components/RequireAuth";
import { AuthProvider } from "./context/AuthContext";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/market" element={<RequireAuth><Market /></RequireAuth>} />
          <Route path="/leaderboard" element={<RequireAuth><Leaderboard /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 8: Rewrite `components/Navbar.jsx`**

```jsx
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Navbar() {
  const { user, token, logout } = useAuth();
  if (!token) return null; // hidden on login/register

  return (
    <nav style={{ padding: "10px", display: "flex", gap: "20px", alignItems: "center" }}>
      <Link to="/">Dashboard</Link>
      <Link to="/market">Market</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <Link to="/profile">Profile</Link>
      <span style={{ marginLeft: "auto" }}>
        Signed in as <strong>{user?.username || "…"}</strong>
      </span>
      <button type="button" onClick={logout}>Log out</button>
    </nav>
  );
}

export default Navbar;
```

- [ ] **Step 9: Update `services/marketApi.js`**

Replace `placeOrder` and remove the dead `getUsers`/`registerUser`:

```js
export async function placeOrder({ symbol, side, quantity }) {
  const res = await api.post("/me/orders", { symbol, side, quantity });
  return res.data.data;
}
```

(Delete `getUsers` and `registerUser`; keep `getPrices`/`getCandles`.)

- [ ] **Step 10: Update `components/TradePanel.jsx`**

Swap the dev bridge for auth:

```jsx
import { useState } from "react";
import { placeOrder } from "../services/marketApi";
import { useAuth } from "../context/AuthContext";

function TradePanel({ symbol, price }) {
  const { user } = useAuth();
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(side) {
    if (!(Number(quantity) > 0)) {
      setStatus({ ok: false, message: "Quantity must be greater than 0." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await placeOrder({ symbol, side, quantity: Number(quantity) });
      setStatus({ ok: true, message: `${side} ${quantity} ${symbol} @ $${Number(result.executedPrice).toFixed(2)}` });
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div>Trading as <strong>{user?.username}</strong></div>
      <div>{symbol} @ ${Number(price).toFixed(2)}</div>
      <input type="number" min="0" step="any" value={quantity}
        onChange={(e) => setQuantity(e.target.value)} />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" disabled={busy} onClick={() => submit("BUY")}>Buy</button>
        <button type="button" disabled={busy} onClick={() => submit("SELL")}>Sell</button>
      </div>
      {status && <div style={{ color: status.ok ? "green" : "crimson" }}>{status.message}</div>}
    </div>
  );
}

export default TradePanel;
```

- [ ] **Step 11: Fix `pages/Dashboard.jsx`**

Point it at the authenticated portfolio:

```jsx
import { useEffect, useState } from "react";
import api from "../services/api";

function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/me/portfolio")
      .then((res) => setPortfolio(res.data.data))
      .catch(() => setError("Couldn't load portfolio"));
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p>Cash: ${portfolio?.cashBalance}</p>
      <p>Equity: ${portfolio?.totalEquity}</p>
      <p>ROI: {portfolio?.roiPct}%</p>
    </div>
  );
}

export default Dashboard;
```

(Keys confirmed against `portfolioService.getPortfolio`: `cashBalance`, `holdingsValue`, `totalEquity`, `roiPct`, `positions`, `unpricedSymbols`, etc.)

- [ ] **Step 12: Delete the dev bridge**

```bash
rm paper-trading-ui/src/context/ActiveUserContext.jsx paper-trading-ui/src/components/UserPicker.jsx
```

Grep to confirm nothing still imports them:

```bash
grep -rn "ActiveUser\|UserPicker" paper-trading-ui/src || echo "clean"
```

- [ ] **Step 13: Lint, build, unit test**

Run from `paper-trading-ui/`:

```bash
npm run lint
npm run build
npm run test
```

Expected: all pass. Fix any lint (unused imports, hook deps) before proceeding.

- [ ] **Step 14: Commit**

```bash
git add paper-trading-ui/src
git commit -m "feat(step10): frontend auth (login/register, token interceptors) retiring dev bridge"
```

---

### Task 7: Docs — TODO + MEMORY

**Files:** Modify `TODO.md`, `MEMORY.md`.

- [ ] **Step 1: Mark Step 10 done in `TODO.md`**

Replace the Step 10 block:

```markdown
## ✅ Step 10 — Authentication & accounts
- [x] JWT bearer strategy; hashing (scrypt) + signing (HS256) via built-in `crypto` — no new deps
- [x] `password_hash` on users (nullable; legacy dev users stay password-less)
- [x] `POST /api/auth/register`, `POST /api/auth/login`; `requireAuth` middleware
- [x] Token-scoped `/api/me/*` (wallet/positions/portfolio/orders/reset)
- [x] Frontend: AuthContext + login/register, axios token interceptors, retired dev active-user bridge
- [x] Tests: crypto utils, register/login, requireAuth, /api/me scoping (existing 57 still green)
```

Add to the backlog list:

```markdown
- [ ] Lock down / remove legacy unauthenticated `/api/users/*` + `/api/orders` (superseded by `/api/me/*`)
```

Update `_Last updated:_` to `2026-07-03 (Step 10 complete)`.

- [ ] **Step 2: Update `MEMORY.md`**

Add these rows to the Route table:

```markdown
| `POST /api/auth/register` | auth.routes.js | `authController.register` | `authService.register` |
| `POST /api/auth/login` | auth.routes.js | `authController.login` | `authService.login` |
| `GET /api/me` (+ /wallet, /positions, /portfolio, /orders) | me.routes.js | `meController.*` | wallet/portfolio/order services |
| `POST /api/me/orders`, `DELETE /api/me/orders/:id`, `POST /api/me/reset` | me.routes.js | `meController.*` | `orderService` / `resetService` |
```

Update the mounts sentence to include `/auth` and `/me`. Add a new section after "Reset / panic button (Step 9)":

```markdown
## Authentication (Step 10)
JWT bearer auth using only Node `crypto` (no deps). `utils/password.js` hashes with
scrypt (`scrypt$salt$key`); `utils/token.js` signs/verifies HS256 JWTs (secret from
`JWT_SECRET`, dev fallback). `POST /api/auth/register` (username,email,password ≥ 8)
hashes + creates user+wallet in one tx and returns `{user, token}`; `POST /api/auth/login`
verifies and returns a token (generic 401; NULL-hash legacy users can't log in).
`middleware/auth.requireAuth` verifies the `Authorization: Bearer` token and sets
`req.userId`. The `/api/me/*` router (all behind requireAuth) scopes wallet/positions/
portfolio/orders/reset to the token user — the id never comes from the client. `users.
password_hash` is nullable so legacy `POST /api/users` dev users still work and the prior
57 tests stay green; locking down the legacy `/api/users/*` + `/api/orders` surface is a
noted follow-up. Frontend: `context/AuthContext.jsx` + `services/authApi.js`, login/register
pages, a `RequireAuth` guard, and an axios interceptor that attaches the token and bounces
to `/login` on 401 — replacing the retired `ActiveUserContext`/`UserPicker` dev bridge.
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md MEMORY.md
git commit -m "docs(step10): mark Step 10 complete in TODO/MEMORY"
```

---

## Self-Review

**1. Spec coverage:**
- JWT strategy, built-in crypto → Task 1. ✓
- `password_hash` (nullable) + repo auth lookup → Task 2. ✓
- register/login + validation + 409 + generic 401 + legacy NULL-hash 401 → Task 3. ✓
- `requireAuth` (missing/malformed/garbage/expired) → Tasks 1 (expiry unit) + 3 (HTTP). ✓
- `/api/me/*` scoped to token user, isolation between users, LIMIT+cancel+reset → Task 4. ✓
- Legacy routes untouched; 57 existing tests green → Tasks 2–4 (nullable hash, no legacy edits). ✓
- `JWT_SECRET` documented → Task 5. ✓
- Frontend: AuthContext, login/register, interceptors, RequireAuth, Navbar logout, TradePanel→/me/orders, delete dev bridge, Dashboard fix → Task 6. ✓
- Docs → Task 7. ✓

**2. Placeholder scan:** No TBD/"handle edge cases". Frontend Dashboard field names flagged to verify against the actual portfolio shape (Task 6 Step 11) — the only intentional "confirm real keys" note.

**3. Type consistency:**
- `hashPassword→string`, `verifyPassword→bool`; consumed in `auth.service`. ✓
- `signToken({sub})`/`verifyToken→{sub,iat,exp}`; `requireAuth` reads `payload.sub`→`req.userId`; `me.controller` uses `req.userId`. ✓
- `userRepository.create({username,email,passwordHash})` hash-free RETURNING; `findAuthByEmail→{...,password_hash}` used only in `authService.login`. ✓
- Auth response `{status:'success',data:{user,token}}`; frontend `authApi` returns `res.data.data`; `AuthContext.persist({user,token})`. ✓
- `/api/me/orders` POST returns `{data:{order}}` for LIMIT (matches Task 4 test `.data.order.id`) and the market result object otherwise. ✓

---

## Notes / things only the user can do

- **Manual login→trade check** (no DOM test lib): start backend (`npm run dev`) + frontend (`npm run dev`), register at `/register`, confirm redirect to Dashboard, buy on `/market`, see the position, log out, and confirm protected routes bounce to `/login`.
- Set a real `JWT_SECRET` in `backend/.env` (dev fallback works but warns).
- Run `npm run db:reset` once so the `password_hash` column exists before running the backend suite.
