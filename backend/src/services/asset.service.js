const assetRepository = require('../repositories/asset.repository');

// Read-only catalogue of tradable assets and their latest market price.
// Shapes DB rows into a UI-friendly view (camelCase, price as a string or null
// for unpriced assets).
const assetService = {
  async listAssets() {
    const rows = await assetRepository.listWithPrices();
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      assetClass: r.asset_class,
      currentPrice: r.current_price, // string (DECIMAL) or null when unpriced
      priceUpdatedAt: r.price_updated_at || null,
    }));
  },
};

module.exports = assetService;
