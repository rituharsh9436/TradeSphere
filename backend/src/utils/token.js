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
