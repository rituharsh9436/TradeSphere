const pool = require('../config/database');

// Data-access for the wallets table. Like the user repository, every method
// accepts an optional `client` so balance reads/writes can participate in the
// same transaction as an order execution.
const walletRepository = {
  async create({ userId, balance }, client = pool) {
    // balance is optional; the column defaults to the starting virtual cash.
    if (balance === undefined) {
      const { rows } = await client.query(
        `INSERT INTO wallets (user_id) VALUES ($1)
         RETURNING id, user_id, balance, updated_at`,
        [userId]
      );
      return rows[0];
    }
    const { rows } = await client.query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
       RETURNING id, user_id, balance, updated_at`,
      [userId, balance]
    );
    return rows[0];
  },

  async findByUserId(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, balance, updated_at FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  // Locks the wallet row FOR UPDATE so concurrent order executions serialize on
  // it — the core of the over-draft / race-condition protection. MUST be called
  // inside a transaction (pass the transaction client).
  async findByUserIdForUpdate(userId, client) {
    const { rows } = await client.query(
      `SELECT id, user_id, balance, updated_at FROM wallets
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    return rows[0] || null;
  },

  async updateBalance(userId, newBalance, client = pool) {
    const { rows } = await client.query(
      `UPDATE wallets
       SET balance = $2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING id, user_id, balance, updated_at`,
      [userId, newBalance]
    );
    return rows[0] || null;
  },
};

module.exports = walletRepository;
