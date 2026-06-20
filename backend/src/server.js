require('dotenv').config();
const app = require('./app');
const pool = require('./config/database');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Quick query to ensure the database is actually reachable before starting the server
    await pool.query('SELECT NOW()');
    
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to connect to the database. Server shutting down.', error);
    process.exit(1);
  }
};

startServer();