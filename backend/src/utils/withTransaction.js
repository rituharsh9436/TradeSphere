const pool = require('../config/database');

// Runs `work` inside a single BEGIN/COMMIT block, passing it a dedicated client.
// Rolls back on any thrown error and always releases the client back to the pool.
// This is the foundation for atomic order execution (wallet lock + position +
// ledger insert all-or-nothing).
module.exports = async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
