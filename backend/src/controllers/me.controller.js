const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const userService = require('../services/user.service');
const walletService = require('../services/wallet.service');
const portfolioService = require('../services/portfolio.service');
const orderService = require('../services/order.service');
const resetService = require('../services/reset.service');

// Thin adapters for the authenticated user. The user id ALWAYS comes from
// req.userId (set by requireAuth) — never from the body or params.
const meController = {
  getMe: catchAsync(async (req, res) => {
    const user = await userService.getById(req.userId);
    res.status(200).json({ status: 'success', data: { user } });
  }),

  getWallet: catchAsync(async (req, res) => {
    const wallet = await walletService.getByUserId(req.userId);
    res.status(200).json({ status: 'success', data: wallet });
  }),

  getPositions: catchAsync(async (req, res) => {
    const positions = await portfolioService.getPositions(req.userId);
    res.status(200).json({ status: 'success', results: positions.length, data: positions });
  }),

  getPortfolio: catchAsync(async (req, res) => {
    const portfolio = await portfolioService.getPortfolio(req.userId);
    res.status(200).json({ status: 'success', data: portfolio });
  }),

  listOrders: catchAsync(async (req, res) => {
    const orders = await orderService.listOrders(req.userId);
    res.status(200).json({ status: 'success', results: orders.length, data: orders });
  }),

  placeOrder: catchAsync(async (req, res) => {
    const { symbol, side, quantity, orderType, targetPrice } = req.body;
    const type = orderType ? String(orderType).toUpperCase() : 'MARKET';
    if (!['MARKET', 'LIMIT'].includes(type)) {
      throw new AppError('orderType must be MARKET or LIMIT.', 400);
    }
    const data =
      type === 'LIMIT'
        ? { order: await orderService.placeLimitOrder({ userId: req.userId, symbol, side, quantity, targetPrice }) }
        : await orderService.placeMarketOrder({ userId: req.userId, symbol, side, quantity });
    res.status(201).json({ status: 'success', data });
  }),

  cancelOrder: catchAsync(async (req, res) => {
    const order = await orderService.cancelOrder({ orderId: req.params.id, userId: req.userId });
    res.status(200).json({ status: 'success', data: order });
  }),

  reset: catchAsync(async (req, res) => {
    const summary = await resetService.resetAccount({ userId: req.userId });
    res.status(200).json({ status: 'success', data: summary });
  }),
};

module.exports = meController;
