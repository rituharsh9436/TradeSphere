const marketService = require('../services/market.service');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// Thin HTTP adapters over the market service.
const marketController = {
  getPrices: catchAsync(async (req, res) => {
    const prices = await marketService.getPrices();
    res.status(200).json({ status: 'success', results: prices.length, data: prices });
  }),

  getPrice: catchAsync(async (req, res) => {
    const price = await marketService.getPriceBySymbol(req.params.symbol);
    res.status(200).json({ status: 'success', data: price });
  }),

  getCandles: catchAsync(async (req, res) => {
    const { symbol, interval, from, to } = req.query;
    if (!symbol) throw new AppError('symbol query parameter is required.', 400);
    const data = await marketService.getCandles({ symbol, interval, from, to });
    res.status(200).json({ status: 'success', data });
  }),
};

module.exports = marketController;
