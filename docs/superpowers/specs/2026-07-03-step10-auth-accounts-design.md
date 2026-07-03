# Step 10 — Authentication & accounts — Design

**Date:** 2026-07-03
**Status:** Approved (design gate passed)

## Goal

Add real user authentication so every account is password-protected and per-user
data (wallet, positions, portfolio, orders, reset) is scoped to the *authenticated*
user rather than an id passed in the URL/body. Retire the frontend dev "active
user" bridge (`ActiveUserContext` + `UserPicker`) in favour of a real login/register
flow.

## Decisions (locked with the user)

- **Strategy:** JWT bearer tokens (stateless). Login/register return a signed token;
  the SPA sends it as `Authorization: Bearer <token>`.
- **Dependencies:** none added — hashing via Node `crypto.scrypt`, token signing via
  `crypto` HMAC-SHA256 (hand-rolled HS256 JWT).
- **Endpoint shape:** new `/api/me/*` routes read the user from the token.
- **Scope:** backend auth **and** frontend retirement of the dev bridge.

## Backend

### Schema (`init-db.js`)

Add to the `users` table:

```sql
password_hash VARCHAR(255)   -- nullable (see note)
```

Plus an idempotent migration line for already-existing databases:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
```

**Nullable is deliberate.** The legacy `POST /api/users {username,email}` path keeps
creating password-less "dev" users (NULL hash → cannot log in). This keeps the 57
existing tests green while `POST /api/auth/register` populates a real hash. Login
treats a NULL hash as "invalid credentials".

### Crypto utilities (built-in `crypto`)

`utils/password.js`:
- `hashPassword(plain) → Promise<string>` — 16-byte random salt, `scrypt(plain, salt, 64)`,
  stored as `scrypt$<saltHex>$<keyHex>`.
- `verifyPassword(plain, stored) → Promise<boolean>` — parse the stored triplet,
  re-derive, compare with `crypto.timingSafeEqual`. Returns `false` (never throws) for
  malformed/empty stored values.

`utils/token.js`:
- `signToken(payload, { expiresInSec = 604800 } = {}) → string` — HS256 JWT:
  `base64url(header) . base64url(payload) . base64url(HMAC-SHA256(secret, ...))`,
  header `{alg:'HS256',typ:'JWT'}`, payload merges `{ iat, exp }`.
- `verifyToken(token) → payload` — split, recompute signature (timing-safe), check `exp`;
  throws `AppError('Invalid or expired token.', 401)` on any failure.
- Secret from `process.env.JWT_SECRET`; if unset, a hardcoded dev fallback + a one-time
  `console.warn` (never crash local dev).

### Repository changes (`user.repository.js`)

- `create({ username, email, passwordHash = null }, client)` — insert `password_hash`
  too; keep `RETURNING` hash-free.
- `findAuthByEmail(email, client) → { id, username, email, password_hash } | null` — the
  only method that returns the hash (for login). `findById`/`findByEmail`/`findAll` stay
  hash-free.

### Auth service (`services/auth.service.js`)

- `register({ username, email, password }) → { user, token }`
  - Validate: username & email present; password a string ≥ 8 chars (else `AppError(400)`).
  - `findByEmail` → 409 if taken.
  - `hashPassword`, then in one `withTransaction`: `userRepository.create({...,passwordHash})`
    + `walletRepository.create` (mirrors the existing atomic user+wallet invariant).
  - Return the hash-free user + `signToken({ sub: user.id })`.
- `login({ email, password }) → { user, token }`
  - `findAuthByEmail`; if missing or `password_hash` NULL or `verifyPassword` false →
    `AppError('Invalid email or password.', 401)` (generic; no user enumeration).
  - Return hash-free user + fresh token.

### Middleware (`middleware/auth.js`)

`requireAuth(req, res, next)`:
- Read `Authorization` header; require `Bearer <token>` → else `AppError(401)`.
- `verifyToken`; set `req.userId = payload.sub`. `catchAsync`-compatible (throws `AppError`).

### Controllers + routes

- `controllers/auth.controller.js` — `register` (201 `{status:'success',data:{user,token}}`),
  `login` (200 same shape).
- `routes/auth.routes.js` — `POST /register`, `POST /login`. Mounted at `/api/auth`.
- `controllers/me.controller.js` — thin adapters calling existing services with `req.userId`:
  - `getMe` → `userService.getById` → `{user}`
  - `getWallet` → `walletService.getByUserId`
  - `getPositions` → `portfolioService.getPositions`
  - `getPortfolio` → `portfolioService.getPortfolio`
  - `listOrders` → `orderService.listOrders`
  - `placeOrder` → `orderService.placeMarketOrder`/`placeLimitOrder` (body: symbol, side,
    quantity, orderType?, targetPrice?; **userId comes from the token**)
  - `cancelOrder` → `orderService.cancelOrder({ orderId: req.params.id, userId: req.userId })`
  - `reset` → `resetService.resetAccount({ userId: req.userId })`
- `routes/me.routes.js` — applies `requireAuth` to the whole router, then:
  `GET /` · `GET /wallet` · `GET /positions` · `GET /portfolio` · `GET /orders` ·
  `POST /orders` · `DELETE /orders/:id` · `POST /reset`. Mounted at `/api/me`.
- `routes/index.js` — mount `/auth` and `/me`.

### Legacy routes

`/api/users/*` and `/api/orders` are left **unchanged and unauthenticated** as an
internal/dev surface so the 57 existing tests do not regress. Trade-off acknowledged:
they remain open this step. Fully locking them down (which would rewrite every existing
test to authenticate) is deferred to a clean follow-up, noted in TODO backlog.

### New env var

`JWT_SECRET` — added to `.env.example` with a comment; read with a dev fallback.

## Frontend (retire the dev bridge)

- `services/api.js` — request interceptor attaches `Authorization: Bearer <token>` from
  `localStorage['mlx.token']`; response interceptor: on 401, clear token and redirect to
  `/login`.
- `services/authApi.js` — `register({username,email,password})`, `login({email,password})`,
  `getMe()` (all return the inner `data`).
- `context/AuthContext.jsx` — `{ token, user, loading }` + `login`, `register`, `logout`.
  Persists token to `localStorage`. On mount with a stored token, calls `getMe()` to
  hydrate `user` (logout on failure).
- `pages/Login.jsx`, `pages/Register.jsx` — simple forms; on success store token+user and
  navigate to `/`.
- `App.jsx` — wrap in `AuthProvider`; add `/login`, `/register`; guard app routes with a
  `RequireAuth` component (redirect to `/login` when no token).
- `components/Navbar.jsx` — replace `UserPicker` with `Signed in as <username>` + a Logout
  button; hide nav when unauthenticated.
- `components/TradePanel.jsx` — drop `useActiveUser`; call `placeOrder` which now POSTs to
  `/me/orders` with no `userId`. Show the signed-in username from `AuthContext`.
- `services/marketApi.js` — `placeOrder` → `POST /me/orders {symbol,side,quantity}`; remove
  now-dead `getUsers`/`registerUser`.
- `pages/Dashboard.jsx` — fix the stale `/portfolio` call to `GET /me/portfolio`.
- **Delete** `context/ActiveUserContext.jsx` and `components/UserPicker.jsx`.

## Testing

- **Backend — new `tests/auth.test.js`:**
  - `password.js`: hash≠plain, verify true/false, malformed stored → false.
  - `token.js`: sign→verify round-trip; tampered token rejected; expired token rejected.
  - `POST /api/auth/register`: 201 returns user+token, wallet provisioned; duplicate email 409;
    short/absent password 400.
  - `POST /api/auth/login`: 200 with valid creds; wrong password 401; unknown email 401;
    legacy NULL-hash user 401.
  - `requireAuth`: no header 401; malformed header 401; garbage token 401.
  - `/api/me/*` scoping: with a valid token, `GET /api/me/wallet` returns *that* user's wallet;
    `POST /api/me/orders` fills for the token user; `GET /api/me` returns the right identity;
    two users' tokens see only their own data.
  - Existing 57 tests remain green (legacy surface untouched).
- **Frontend:** no DOM test lib installed. Verification = `npm run lint` + `npm run build`
  pass, plus one Vitest unit test for a pure token-storage helper (`lib/authStorage.js`
  read/write/clear). Manual check of the login→trade flow by the user (as with the 6b chart).

## Invariants / security notes

- Passwords never logged or returned; only `password_hash` persists, and only `findAuthByEmail`
  reads it.
- Login failures are generic (no distinction between unknown email and wrong password).
- Tokens are signed (HS256) and expiry-checked; tampering fails signature verification.
- `req.userId` always comes from the verified token on `/api/me/*` — a client cannot act as
  another user through those routes.

## Non-goals

- Refresh tokens / token revocation / rotation (stateless bearer only).
- Password reset / email verification flows.
- Locking down or removing the legacy `/api/users/*` + `/api/orders` routes (follow-up).
- Role/permission model (all authenticated users are equal).
