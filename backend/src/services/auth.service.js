const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');

const MIN_PASSWORD_LEN = 8;

// A well-formed (salt/key of the right length) but unmatchable hash. When an
// email is unknown or a legacy account has a NULL password_hash, we still run a
// full scrypt verification against this so the login path costs the same as a
// real wrong-password attempt — closing the timing side-channel that would
// otherwise let an attacker enumerate which emails are registered.
const DUMMY_PASSWORD_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

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
    // Always run one verification (against a dummy hash when there is no usable
    // account) so timing does not reveal whether the email exists. A match only
    // counts when the account actually has a stored hash.
    const storedHash = account && account.password_hash ? account.password_hash : DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(password, storedHash);
    const ok = passwordMatches && Boolean(account && account.password_hash);
    if (!ok) throw new AppError('Invalid email or password.', 401);

    const user = { id: account.id, username: account.username, email: account.email };
    return { user, token: signToken({ sub: user.id }) };
  },
};

module.exports = authService;
