const pool = require('../config/database');

// Data-access for assets and their latest market price.
const assetRepository = {
  async findBySymbol(symbol, client = pool) {
    const { rows } = await client.query(
      `SELECT id, symbol, name, asset_class, is_active
       FROM assets WHERE symbol = $1`,
      [symbol]
    );
    return rows[0] || null;
  },

  async findById(id, client = pool) {
    const { rows } = await client.query(
      `SELECT id, symbol, name, asset_class, is_active FROM assets WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  // All active assets joined to their latest market price. LEFT JOIN so an
  // unpriced asset still appears (price = null) rather than dropping out.
  // Powers the Market/Trade screens with the same symbols the order engine
  // will accept.
  async listWithPrices(client = pool) {
    const { rows } = await client.query(
      `SELECT a.id, a.symbol, a.name, a.asset_class, a.is_active,
              m.price AS current_price, m.updated_at AS price_updated_at
       FROM assets a
       LEFT JOIN market_prices m ON m.asset_id = a.id
       WHERE a.is_active = TRUE
       ORDER BY a.symbol`
    );
    return rows;
  },

  // Latest known price for an asset, used to fill market orders and value
  // portfolios. Returns the price as a string (DECIMAL) or null if unpriced.
  async getPrice(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT price FROM market_prices WHERE asset_id = $1`,
      [assetId]
    );
    return rows[0] ? rows[0].price : null;
  },
};

module.exports = assetRepository;
