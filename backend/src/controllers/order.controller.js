const orderService = require('../services/order.service');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

const orderController = {
  // POST /api/orders  { userId, symbol, side, quantity, orderType?, targetPrice? }
  // orderType defaults to MARKET (immediate fill); LIMIT rests as PENDING.
  place: catchAsync(async (req, res) => {
    const { userId, symbol, side, quantity, orderType, targetPrice } = req.body;
    const type = orderType ? String(orderType).toUpperCase() : 'MARKET';
    if (!['MARKET', 'LIMIT'].includes(type)) {
      throw new AppError('orderType must be MARKET or LIMIT.', 400);
    }
    const data =
      type === 'LIMIT'
        ? { order: await orderService.placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) }
        : await orderService.placeMarketOrder({ userId, symbol, side, quantity });
    res.status(201).json({ status: 'success', data });
  }),

  // DELETE /api/orders/:id?userId=...  — cancel a pending order.
  cancel: catchAsync(async (req, res) => {
    const order = await orderService.cancelOrder({
      orderId: req.params.id,
      userId: req.query.userId,
    });
    res.status(200).json({ status: 'success', data: order });
  }),

  // GET /api/orders/user/:userId
  listForUser: catchAsync(async (req, res) => {
    const orders = await orderService.listOrders(req.params.userId);
    res.status(200).json({ status: 'success', results: orders.length, data: orders });
  }),
};

module.exports = orderController;
