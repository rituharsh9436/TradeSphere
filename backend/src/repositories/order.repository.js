const pool = require('../config/database');

// Data-access for the orders table.
const orderRepository = {
  async create(
    { userId, assetId, orderType, side, quantity, targetPrice = null, status = 'PENDING', advancedParams = null },
    client = pool
  ) {
    // If client is pool, we might want a transaction for advanced orders.
    // For simplicity, we'll assume we can run them sequentially or use a real transaction wrapper if provided.
    const isLocalTx = client === pool && advancedParams;
    const db = isLocalTx ? await pool.connect() : client;

    try {
      if (isLocalTx) await db.query('BEGIN');

      const { rows } = await db.query(
        `INSERT INTO orders (user_id, asset_id, order_type, side, quantity, target_price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, asset_id, order_type, side, quantity, target_price, status, created_at`,
        [userId, assetId, orderType, side, quantity, targetPrice, status]
      );
      const order = rows[0];

      if (orderType === 'ADVANCED' && advancedParams) {
        await db.query(
          `INSERT INTO advanced_orders (order_id, advanced_type, trigger_price, trail_amount, trail_percent, high_water_mark, time_in_force)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            order.id,
            advancedParams.advanced_type,
            advancedParams.trigger_price,
            advancedParams.trail_amount,
            advancedParams.trail_percent,
            advancedParams.high_water_mark,
            advancedParams.time_in_force || 'DAY'
          ]
        );
      }

      if (isLocalTx) await db.query('COMMIT');
      return order;
    } catch (err) {
      if (isLocalTx) await db.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTx) db.release();
    }
  },

  async updateStatus(id, status, client = pool) {
    const { rows } = await client.query(
      `UPDATE orders
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, status`,
      [id, status]
    );
    return rows[0] || null;
  },

  // PENDING limit orders for one asset — the matcher's candidate set per tick.
  async findPendingLimitByAsset(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, side, quantity, target_price
       FROM orders
       WHERE asset_id = $1 AND order_type = 'LIMIT' AND status = 'PENDING'`,
      [assetId]
    );
    return rows;
  },

  // Bulk-cancels every PENDING order for a user (used by the reset/panic button).
  // Returns the cancelled ids; non-pending orders are left as-is.
  async cancelAllPendingByUser(userId, client = pool) {
    const { rows } = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND status = 'PENDING'
       RETURNING id`,
      [userId]
    );
    return rows;
  },

  // Locks a single order row so a fill/cancel can re-check status before mutating.
  async findByIdForUpdate(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, user_id, asset_id, order_type, side, quantity, target_price, status
       FROM orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] || null;
  },

  // Fetch pending advanced orders with their advanced parameters joined
  async findPendingAdvancedByAsset(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT o.id, o.user_id, o.asset_id, o.side, o.quantity, o.status,
              a.advanced_type, a.trigger_price, a.trail_amount, a.trail_percent, a.high_water_mark, a.time_in_force
       FROM orders o
       JOIN advanced_orders a ON o.id = a.order_id
       WHERE o.asset_id = $1 AND o.status = 'PENDING' AND o.order_type = 'ADVANCED'`,
      [assetId]
    );
    return rows;
  },

  // Atomic fade-in for the trailing stop HWM. For SELL the HWM only ratchets
  // up; for BUY it only ratchets down. The matcher supplies the new value plus
  // the side, so two parallel ticks can't both write a stale HWM — the smaller
  // (or older) of the two updates finds zero rows and is effectively a no-op.
  // Returns the rowcount so callers can skip the per-tick trigger recompute
  // when the UPDATE was a no-op.
  async ratchetTrailingStop(
    { orderId, newHwm, newTrigger, side },
    client = pool
  ) {
    const cmp = side === 'BUY' ? '<' : '>';
    const { rowCount } = await client.query(
      `UPDATE advanced_orders
       SET high_water_mark = $2, trigger_price = $3
       WHERE order_id = $1
         AND (high_water_mark IS NULL OR high_water_mark ${cmp} $2)`,
      [orderId, newHwm, newTrigger]
    );
    return rowCount;
  },

  async listByUser(userId, client = pool) {
    const { rows } = await client.query(
      `SELECT o.id, o.order_type, o.side, o.quantity, o.target_price, o.status,
              o.created_at, a.symbol,
              ad.advanced_type, ad.trigger_price, ad.trail_amount, ad.trail_percent, ad.high_water_mark, ad.time_in_force
       FROM orders o
       JOIN assets a ON a.id = o.asset_id
       LEFT JOIN advanced_orders ad ON ad.order_id = o.id
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId]
    );
    return rows;
  },
};

module.exports = orderRepository;
