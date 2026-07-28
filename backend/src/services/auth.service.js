const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');
const registrationOtpRepository = require('../repositories/registrationOtp.repository');
const { sendRegistrationOtp } = require('./email.service');
const crypto = require('node:crypto');

const MIN_PASSWORD_LEN = 8;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

// Emails are identity — normalize to a canonical form (trim + lowercase) on both
// write and lookup so case/whitespace variants can't create duplicate accounts or
// break login (e.g. registering "Foo@X.com" then logging in as "foo@x.com").
const normalizeEmail = (email) => String(email).trim().toLowerCase();

// A well-formed (salt/key of the right length) but unmatchable hash. When an
// email is unknown or a legacy account has a NULL password_hash, we still run a
// full scrypt verification against this so the login path costs the same as a
// real wrong-password attempt — closing the timing side-channel that would
// otherwise let an attacker enumerate which emails are registered.
const DUMMY_PASSWORD_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function otpSecret() {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new AppError('Email verification is temporarily unavailable. Please try again later.', 503);
  return secret;
}

function hashOtp(email, code) {
  return crypto.createHmac('sha256', otpSecret()).update(`${email}:${code}`).digest('hex');
}

function validRegistration({ fullName, username, email, password }) {
  if (!fullName || !String(fullName).trim()) throw new AppError('Full name is required.', 400);
  if (!username || !String(username).trim()) throw new AppError('Username is required.', 400);
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(String(username).trim())) {
    throw new AppError('Username must be 3–30 characters and use only letters, numbers, dots, hyphens, or underscores.', 400);
  }
  if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim())) throw new AppError('Enter a valid email address.', 400);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
    throw new AppError(`password must be at least ${MIN_PASSWORD_LEN} characters.`, 400);
  }
}

const authService = {
  async requestRegistrationOtp({ fullName, username, email, password }) {
    console.log(`[AuthService] OTP Request initiated for email: ${email}`);
    validRegistration({ fullName, username, email, password });
    const normalizedEmail = normalizeEmail(email);
    const normalizedUsername = String(username).trim();
    const existing = await userRepository.findByEmail(normalizedEmail);
    if (existing) {
      console.warn(`[AuthService] OTP Request failed: Email ${normalizedEmail} already exists.`);
      throw new AppError('A user with this email already exists.', 409);
    }
    const usernameOwner = await userRepository.findByUsername(normalizedUsername);
    if (usernameOwner) {
      console.warn(`[AuthService] OTP Request failed: Username ${normalizedUsername} already taken.`);
      throw new AppError('This username is already taken. Choose another one.', 409);
    }
    const passwordHash = await hashPassword(password);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    
    console.log(`[AuthService] Upserting OTP record to DB for ${normalizedEmail}...`);
    await registrationOtpRepository.upsert({
      email: normalizedEmail,
      fullName: String(fullName).trim(),
      username: normalizedUsername,
      passwordHash,
      codeHash: hashOtp(normalizedEmail, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    
    console.log(`[AuthService] Dispatching email via EmailService for ${normalizedEmail}...`);
    await sendRegistrationOtp({ email: normalizedEmail, code });
    console.log(`[AuthService] Successfully completed OTP request for ${normalizedEmail}.`);
  },

  // A user and wallet are created only after the one-time email code is verified.
  async register({ email, code }) {
    console.log(`[AuthService] Registration attempt for email: ${email}`);
    if (!email || !/^\d{6}$/.test(String(code || ''))) {
      console.warn(`[AuthService] Registration failed: Missing email or malformed code.`);
      throw new AppError('email and a 6-digit verification code are required.', 400);
    }
    const normalizedEmail = normalizeEmail(email);
    const user = await withTransaction(async (client) => {
      console.log(`[AuthService] Checking DB for pending OTP for ${normalizedEmail}...`);
      const pending = await registrationOtpRepository.findForUpdate(normalizedEmail, client);
      if (!pending || new Date(pending.expires_at) <= new Date() || pending.attempts >= MAX_OTP_ATTEMPTS) {
        if (pending) await registrationOtpRepository.remove(normalizedEmail, client);
        console.warn(`[AuthService] Registration failed: OTP expired, missing, or max attempts reached for ${normalizedEmail}.`);
        throw new AppError('Verification code is invalid or has expired. Request a new code.', 400);
      }
      const expected = Buffer.from(pending.code_hash, 'hex');
      const supplied = Buffer.from(hashOtp(normalizedEmail, String(code)), 'hex');
      if (!crypto.timingSafeEqual(expected, supplied)) {
        await registrationOtpRepository.incrementAttempts(normalizedEmail, client);
        console.warn(`[AuthService] Registration failed: Incorrect code for ${normalizedEmail}.`);
        throw new AppError('Verification code is invalid or has expired. Request a new code.', 400);
      }
      
      console.log(`[AuthService] Code verified. Creating user and wallet for ${normalizedEmail}...`);
      const created = await userRepository.create(
        { fullName: pending.full_name, username: pending.username, email: normalizedEmail, passwordHash: pending.password_hash },
        client
      );
      await walletRepository.create({ userId: created.id }, client);
      await registrationOtpRepository.remove(normalizedEmail, client);
      console.log(`[AuthService] User ${created.id} successfully created via OTP.`);
      return created;
    });

    return { user, token: signToken({ sub: user.id }) };
  },

  // Verify credentials and issue a token. Failures are generic (no user
  // enumeration); a NULL password_hash (legacy dev user) can never authenticate.
  async login({ email, password }) {
    console.log(`[AuthService] Login attempt for email: ${email}`);
    if (!email || !password) throw new AppError('email and password are required.', 400);
    const account = await userRepository.findAuthByEmail(normalizeEmail(email));
    // Always run one verification (against a dummy hash when there is no usable
    // account) so timing does not reveal whether the email exists. A match only
    // counts when the account actually has a stored hash.
    const storedHash = account && account.password_hash ? account.password_hash : DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(password, storedHash);
    const ok = passwordMatches && Boolean(account && account.password_hash);
    if (!ok) {
      console.warn(`[AuthService] Login failed for email: ${email}`);
      throw new AppError('Invalid email or password.', 401);
    }

    console.log(`[AuthService] Login successful for user: ${account.id}`);
    const user = { id: account.id, full_name: account.full_name, username: account.username, email: account.email };
    return { user, token: signToken({ sub: user.id }) };
  },
};

module.exports = authService;
