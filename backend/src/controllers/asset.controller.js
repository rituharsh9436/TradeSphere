const assetService = require('../services/asset.service');
const catchAsync = require('../utils/catchAsync');

// Thin HTTP adapter for the asset catalogue.
const assetController = {
  // GET /api/assets — list tradable assets with their latest market price.
  list: catchAsync(async (req, res) => {
    const assets = await assetService.listAssets();
    res.status(200).json({ status: 'success', results: assets.length, data: assets });
  }),
};

module.exports = assetController;
