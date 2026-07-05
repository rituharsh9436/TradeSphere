const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max number of concurrent connections
  idleTimeoutMillis: 30000, 
  connectionTimeoutMillis: 2000,
});

// Verify connection on startup
pool.on('connect', () => {
  console.log('Database connection pool established successfully.');
});

// An idle client can error for routine reasons (Postgres closing an idle
// connection, a brief network blip). pg discards the dead client and hands out a
// fresh one on the next query, so we log and keep serving rather than crash the
// whole process (which would take down the API and market-data pipeline).
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

module.exports = pool;