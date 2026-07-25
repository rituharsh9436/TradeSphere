const pool = require('../config/database');

async function ensureRegistrationOtpSchema() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
    UPDATE users SET full_name = username WHERE full_name IS NULL;
    ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;

    CREATE OR REPLACE FUNCTION reject_transaction_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND current_setting('app.account_deletion', true) = 'on' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'transactions is an append-only ledger: % is not permitted', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE IF NOT EXISTS registration_otps (
      email VARCHAR(255) PRIMARY KEY,
      full_name VARCHAR(100),
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
    ALTER TABLE registration_otps ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
  `);
}

module.exports = { ensureRegistrationOtpSchema };
