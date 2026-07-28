const pool = require('../config/database');

// Keep the advanced-order schema available for deployments that were created
// before the feature existed. This is intentionally safe to run on every boot.
async function ensureAdvancedOrdersSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Multiple application instances can start together. Serialise this small
    // migration so their ALTER TABLE statements cannot race.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tradesphere:advanced-orders-schema-v1'))");
    await client.query(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
      ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
        CHECK (order_type IN ('MARKET', 'LIMIT', 'ADVANCED'));
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS check_limit_has_target;
      ALTER TABLE orders ADD CONSTRAINT check_limit_has_target CHECK (
        (order_type = 'LIMIT' AND target_price IS NOT NULL) OR
        (order_type = 'MARKET' AND target_price IS NULL) OR
        (order_type = 'ADVANCED' AND target_price IS NULL)
      );
      CREATE TABLE IF NOT EXISTS advanced_orders (
        order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
        advanced_type VARCHAR(20) NOT NULL
          CHECK (advanced_type IN ('STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP')),
        trigger_price DECIMAL(15,4),
        trail_amount DECIMAL(15,4),
        trail_percent DECIMAL(5,2),
        high_water_mark DECIMAL(15,4),
        time_in_force VARCHAR(10) NOT NULL DEFAULT 'DAY'
          CHECK (time_in_force IN ('DAY', 'GTC'))
      );
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureAdvancedOrdersSchema };
