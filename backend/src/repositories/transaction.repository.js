const pool = require('../config/database');

// Data-access for the append-only transactions ledger. Only INSERT and SELECT
// are possible — the database trigger rejects UPDATE/DELETE.
const transactionRepository = {
  async create(
    { userId, orderId, transactionType, amount, pricePerShare },
    client = pool
  ) {
    const { rows } = await client.query(
      `INSERT INTO transactions (user_id, order_id, transaction_type, amount, price_per_share)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, order_id, transaction_type, amount, price_per_share, created_at`,
      [userId, orderId, transactionType, amount, pricePerShare]
    );
    return rows[0];
  },

  async listByUser(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT id, order_id, transaction_type, amount, price_per_share, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },
};

module.exports = transactionRepository;
