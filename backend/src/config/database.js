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

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
  process.exit(-1);
});

module.exports = pool;