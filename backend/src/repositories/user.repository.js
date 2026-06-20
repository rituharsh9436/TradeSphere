const pool = require('../config/database');

// Data-access for the users table. Each method accepts an optional `client` so
// callers can enlist the query in an existing transaction; it defaults to the
// pool for standalone use.
const userRepository = {
  async create({ username, email }, client = pool) {
    const { rows } = await client.query(
      `INSERT INTO users (username, email)
       VALUES ($1, $2)
       RETURNING id, username, email, created_at`,
      [username, email]
    );
    return rows[0];
  },

  async findById(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, username, email, created_at FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByEmail(email, client = pool) {
    const { rows } = await client.query(
      `SELECT id, username, email, created_at FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },
};

module.exports = userRepository;
