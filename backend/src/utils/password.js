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
