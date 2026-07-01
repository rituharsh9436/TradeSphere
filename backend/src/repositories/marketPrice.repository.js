const pool = require('../config/database');

// Latest-price store (one row per asset). The ingestion worker upserts here on
// every (throttled) tick; portfolio valuation and the order engine read it.
const marketPriceRepository = {
  async upsertLatest(assetId, price, client = pool) {
    await client.query(
      `INSERT INTO market_prices (asset_id, price)
       VALUES ($1, $2)
       ON CONFLICT (asset_id)
       DO UPDATE SET price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP`,
      [assetId, price]
    );
  },

  async findAll(client = pool) {
    const { rows } = await client.query(
      `SELECT a.symbol, m.price, m.updated_at AS "updatedAt"
       FROM market_prices m
       JOIN assets a ON a.id = m.asset_id
       ORDER BY a.symbol`
    );
    return rows;
  },

  async findBySymbol(symbol, client = pool) {
    const { rows } = await client.query(
      `SELECT a.symbol, m.price, m.updated_at AS "updatedAt"
       FROM market_prices m
       JOIN assets a ON a.id = m.asset_id
       WHERE a.symbol = $1`,
      [symbol]
    );
    return rows[0] || null;
  },
};

module.exports = marketPriceRepository;
