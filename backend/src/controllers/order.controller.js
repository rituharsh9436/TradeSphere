const orderService = require('../services/order.service');
const catchAsync = require('../utils/catchAsync');

const orderController = {
  // POST /api/orders  { userId, symbol, side, quantity }
  // Currently supports MARKET orders (immediate execution).
  placeMarket: catchAsync(async (req, res) => {
    const { userId, symbol, side, quantity } = req.body;
    const result = await orderService.placeMarketOrder({ userId, symbol, side, quantity });
    res.status(201).json({ status: 'success', data: result });
  }),

  // GET /api/orders/user/:userId
  listForUser: catchAsync(async (req, res) => {
    const orders = await orderService.listOrders(req.params.userId);
    res.status(200).json({ status: 'success', results: orders.length, data: orders });
  }),
};

module.exports = orderController;
