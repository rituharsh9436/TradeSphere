const pool = require('../config/database');

const registrationOtpRepository = {
  async upsert({ email, fullName, username, passwordHash, codeHash, expiresAt }) {
    await pool.query(
      `INSERT INTO registration_otps (email, full_name, username, password_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         updated_at = CURRENT_TIMESTAMP`,
      [email, fullName, username, passwordHash, codeHash, expiresAt]
    );
  },

  async findForUpdate(email, client) {
    const { rows } = await client.query(
      `SELECT email, full_name, username, password_hash, code_hash, expires_at, attempts
       FROM registration_otps WHERE email = $1 FOR UPDATE`,
      [email]
    );
    return rows[0] || null;
  },

  async incrementAttempts(email, client) {
    await client.query('UPDATE registration_otps SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE email = $1', [email]);
  },

  async remove(email, client) {
    await client.query('DELETE FROM registration_otps WHERE email = $1', [email]);
  },
};

module.exports = registrationOtpRepository;
