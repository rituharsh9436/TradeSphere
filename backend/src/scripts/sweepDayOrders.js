require('dotenv').config();
const pool = require('../config/database');

// End-of-day sweep for Time-In-Force. Cancels every still-PENDING order whose
// time_in_force policy marks it as DAY (or whose limit policy has no GTC tag).
// GTC orders stay PENDING and are re-evaluated on the next market session.
// Idempotent: running it twice in a row is a no-op the second time.
//
// Run from the repo root:
//   node backend/src/scripts/sweepDayOrders.js
// (or via any node-cron / scheduler wrapper at market close).
const sweepDayOrders = async () => {
  console.log('Sweeping expired DAY orders…');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Standard resting LIMIT orders are treated as DAY-by-default for the sweep:
    // GTC is opt-in via the advanced_orders join below and covers the other arm.
    const limitResult = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'PENDING' AND order_type = 'LIMIT'
       RETURNING id`
    );

    // Advanced orders: only cancel the ones tagged DAY. GTC survives until
    // manually cancelled or the trigger fires.
    const advancedResult = await client.query(
      `UPDATE orders o
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       FROM advanced_orders a
       WHERE o.id = a.order_id
         AND o.status = 'PENDING'
         AND o.order_type = 'ADVANCED'
         AND a.time_in_force = 'DAY'
       RETURNING o.id`
    );

    await client.query('COMMIT');

    console.log(
      `Sweep complete. Limits cancelled: ${limitResult.rowCount}, ` +
        `advanced DAY cancelled: ${advancedResult.rowCount}.`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sweep failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

sweepDayOrders();
