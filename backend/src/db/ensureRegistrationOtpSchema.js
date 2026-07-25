const pool = require('../config/database');

async function ensureRegistrationOtpSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registration_otps (
      email VARCHAR(255) PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_registration_otps_expires_at
      ON registration_otps (expires_at);
  `);
}

module.exports = { ensureRegistrationOtpSchema };
