const pool = require('../config/database');

// Data-access for the users table. Each method accepts an optional `client` so
// callers can enlist the query in an existing transaction; it defaults to the
// pool for standalone use.
const userRepository = {
  async create({ username, fullName = username, email, passwordHash = null }, client = pool) {
    const { rows } = await client.query(
      `INSERT INTO users (full_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, username, email, created_at`,
      [fullName, username, email, passwordHash]
    );
    return rows[0];
  },

  async findById(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, full_name, username, email, created_at FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByEmail(email, client = pool) {
    const { rows } = await client.query(
      `SELECT id, full_name, username, email, created_at FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  async findByUsername(username, client = pool) {
    const { rows } = await client.query(
      `SELECT id, full_name, username, email, created_at FROM users WHERE username = $1`,
      [username]
    );
    return rows[0] || null;
  },

  // Auth-only lookup: the single method that returns password_hash (for login).
  async findAuthByEmail(email, client = pool) {
    const { rows } = await client.query(
      `SELECT id, full_name, username, email, password_hash FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  async findAuthByIdForUpdate(id, client) {
    const { rows } = await client.query(
      `SELECT id, password_hash FROM users WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] || null;
  },

  async deleteAccount(id, client) {
    // The transaction-local flag permits deletion from the otherwise
    // append-only paper-trading ledger; see reject_transaction_mutation().
    await client.query("SELECT set_config('app.account_deletion', 'on', true)");
    await client.query('DELETE FROM transactions WHERE user_id = $1', [id]);
    await client.query('DELETE FROM orders WHERE user_id = $1', [id]);
    await client.query('DELETE FROM positions WHERE user_id = $1', [id]);
    await client.query('DELETE FROM wallets WHERE user_id = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
  },

  async findAll(client = pool) {
    const { rows } = await client.query(
      `SELECT id, full_name, username, email, created_at FROM users ORDER BY created_at ASC`
    );
    return rows;
  },
};

module.exports = userRepository;
