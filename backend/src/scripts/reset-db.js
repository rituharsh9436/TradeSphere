require('dotenv').config();
const pool = require('../config/database');

// Drops all application tables and the append-only trigger function so the
// schema can be rebuilt cleanly. DESTRUCTIVE — intended for development only.
const dropAll = async () => {
  const dropQuery = `
    DROP TRIGGER IF EXISTS trg_transactions_append_only ON transactions;
    DROP FUNCTION IF EXISTS reject_transaction_mutation();

    DROP TABLE IF EXISTS market_prices CASCADE;
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS positions CASCADE;
    DROP TABLE IF EXISTS orders CASCADE;
    DROP TABLE IF EXISTS wallets CASCADE;
    DROP TABLE IF EXISTS assets CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `;

  try {
    console.log('Dropping all tables and ledger trigger...');
    await pool.query(dropQuery);
    console.log('Database reset successfully. Run db:init to rebuild the schema.');
  } catch (error) {
    console.error('Error resetting database:', error);
    process.exitCode = 1; // Report failure to the shell/CI
  } finally {
    await pool.end(); // Close the pool so the script exits
  }
};

dropAll();
