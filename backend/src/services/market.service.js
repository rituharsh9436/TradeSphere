const AppError = require('../utils/AppError');
const assetRepository = require('../repositories/asset.repository');
const marketPriceRepository = require('../repositories/marketPrice.repository');
const priceHistoryRepository = require('../repositories/priceHistory.repository');

const DEFAULT_INTERVAL_SEC = 15;
const MAX_INTERVAL_SEC = 86400; // 1 day
// Cap response size / query cost. Must clear a full default-interval day
// (24h / 15s = 5760) so the default /candles request isn't rejected, while
// still refusing pathological ranges like 24h of 1s buckets (86400).
const MAX_BUCKETS = 6000;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

const marketService = {
  async getPrices() {
    return marketPriceRepository.findAll();
  },

  async getPriceBySymbol(symbol) {
    const price = await marketPriceRepository.findBySymbol(symbol);
    if (!price) throw new AppError('Unknown symbol.', 404);
    return price;
  },

  // OHLC candles aggregated on-read from price_history. Interval/range are
  // validated before any DB access so the cheap rejections stay cheap.
  async getCandles({ symbol, interval, from, to }) {
    const intervalSec = Number(interval ?? DEFAULT_INTERVAL_SEC);
    if (!Number.isInteger(intervalSec) || intervalSec < 1 || intervalSec > MAX_INTERVAL_SEC) {
      throw new AppError('interval must be an integer between 1 and 86400 seconds.', 400);
    }

    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_WINDOW_MS);
    if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) {
      throw new AppError('from/to must be valid dates.', 400);
    }
    if (fromDate >= toDate) {
      throw new AppError('from must be earlier than to.', 400);
    }
    if ((toDate.getTime() - fromDate.getTime()) / 1000 / intervalSec > MAX_BUCKETS) {
      throw new AppError('Requested range is too large for this interval.', 400);
    }

    const asset = await assetRepository.findBySymbol(symbol);
    if (!asset) throw new AppError('Unknown symbol.', 404);

    const candles = await priceHistoryRepository.aggregateCandles({
      symbol, intervalSec, from: fromDate, to: toDate,
    });
    return { symbol, intervalSec, candles };
  },
};

module.exports = marketService;
