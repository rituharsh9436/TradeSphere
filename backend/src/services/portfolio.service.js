const Decimal = require('decimal.js');

const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const portfolioRepository = require('../repositories/portfolio.repository');

// DECIMAL(15,4) in the schema — keep monetary values at 4 dp.
const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);
const PCT_SCALE = 4;
const pct = (value) => new Decimal(value).toFixed(PCT_SCALE);

// ROI baseline. Matches the wallet's default starting cash; there is no deposit
// feature yet, so every user begins with exactly this much virtual capital.
const STARTING_CAPITAL = '100000';

// Shapes one holding row into a valued position. Returns the per-row market
// value (or null when the asset is unpriced) so the caller can total it up.
function valueHolding(row) {
  const quantity = new Decimal(row.quantity);
  const averageBuyPrice = new Decimal(row.average_buy_price);
  const costBasis = quantity.times(averageBuyPrice);

  if (row.current_price === null || row.current_price === undefined) {
    return {
      priced: false,
      view: {
        symbol: row.symbol,
        quantity: money(quantity),
        averageBuyPrice: money(averageBuyPrice),
        currentPrice: null,
        marketValue: null,
        costBasis: money(costBasis),
        unrealizedPnl: null,
        unrealizedPnlPct: null,
      },
      marketValue: null,
      costBasis,
    };
  }

  const currentPrice = new Decimal(row.current_price);
  const marketValue = quantity.times(currentPrice);
  const unrealizedPnl = marketValue.minus(costBasis);
  const unrealizedPnlPct = costBasis.isZero()
    ? new Decimal(0)
    : unrealizedPnl.div(costBasis).times(100);

  return {
    priced: true,
    view: {
      symbol: row.symbol,
      quantity: money(quantity),
      averageBuyPrice: money(averageBuyPrice),
      currentPrice: money(currentPrice),
      marketValue: money(marketValue),
      costBasis: money(costBasis),
      unrealizedPnl: money(unrealizedPnl),
      unrealizedPnlPct: pct(unrealizedPnlPct),
    },
    marketValue,
    costBasis,
  };
}

const portfolioService = {
  async getPositions(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('User not found.', 404);

    const rows = await portfolioRepository.findHoldingsWithPrices(userId);
    return rows.map((r) => valueHolding(r).view);
  },

  // Full portfolio valuation: cash + holdings valued at current market price,
  // with cost basis, unrealized P/L and ROI vs starting capital.
  async getPortfolio(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('User not found.', 404);

    const wallet = await walletRepository.findByUserId(userId);
    if (!wallet) throw new AppError('Wallet not found for this user.', 404);

    const rows = await portfolioRepository.findHoldingsWithPrices(userId);

    const cashBalance = new Decimal(wallet.balance);
    let holdingsValue = new Decimal(0);
    let totalCostBasis = new Decimal(0); // cost basis of priced holdings only
    const positions = [];
    const unpricedSymbols = [];

    for (const row of rows) {
      const valued = valueHolding(row);
      positions.push(valued.view);
      if (valued.priced) {
        holdingsValue = holdingsValue.plus(valued.marketValue);
        totalCostBasis = totalCostBasis.plus(valued.costBasis);
      } else {
        unpricedSymbols.push(row.symbol);
      }
    }

    const totalEquity = cashBalance.plus(holdingsValue);
    const totalUnrealizedPnl = holdingsValue.minus(totalCostBasis);
    const totalUnrealizedPnlPct = totalCostBasis.isZero()
      ? new Decimal(0)
      : totalUnrealizedPnl.div(totalCostBasis).times(100);
    const roiPct = totalEquity
      .minus(STARTING_CAPITAL)
      .div(STARTING_CAPITAL)
      .times(100);

    return {
      cashBalance: money(cashBalance),
      holdingsValue: money(holdingsValue),
      totalEquity: money(totalEquity),
      totalCostBasis: money(totalCostBasis),
      totalUnrealizedPnl: money(totalUnrealizedPnl),
      totalUnrealizedPnlPct: pct(totalUnrealizedPnlPct),
      roiPct: pct(roiPct),
      startingCapital: money(STARTING_CAPITAL),
      unpricedSymbols,
      positions,
    };
  },
};

module.exports = portfolioService;
