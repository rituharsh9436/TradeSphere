const Decimal = require('decimal.js');

const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const assetRepository = require('../repositories/asset.repository');
const walletRepository = require('../repositories/wallet.repository');
const orderRepository = require('../repositories/order.repository');
const positionRepository = require('../repositories/position.repository');
const transactionRepository = require('../repositories/transaction.repository');

// DECIMAL(15,4) in the schema — keep all monetary values at 4 dp.
const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);

// Shared fill core for MARKET and LIMIT orders. Locks the wallet (the per-user
// serialization point) and position FOR UPDATE, then applies the balance/holdings
// check and the position + wallet mutations. Returns { ok:false, reason } for a
// business shortfall (caller decides: MARKET throws 422, LIMIT marks REJECTED) and
// throws only on true errors (missing wallet). Does not touch the order/ledger.
async function settleFill(client, { userId, assetId, side, qty, price }) {
  const grossAmount = new Decimal(price).times(qty);

  const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
  if (!wallet) throw new AppError('Wallet not found for this user.', 404);
  const balance = new Decimal(wallet.balance);
  const position = await positionRepository.findForUpdate(userId, assetId, client);

  let newBalance;
  if (side === 'BUY') {
    if (balance.lt(grossAmount)) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    newBalance = balance.minus(grossAmount);
    if (position) {
      const oldQty = new Decimal(position.quantity);
      const oldCost = oldQty.times(position.average_buy_price);
      const newQty = oldQty.plus(qty);
      const newAvg = oldCost.plus(grossAmount).div(newQty);
      await positionRepository.update(
        { userId, assetId, quantity: money(newQty), averageBuyPrice: money(newAvg) },
        client
      );
    } else {
      await positionRepository.create(
        { userId, assetId, quantity: money(qty), averageBuyPrice: money(price) },
        client
      );
    }
  } else {
    if (!position || new Decimal(position.quantity).lt(qty)) {
      return { ok: false, reason: 'INSUFFICIENT_HOLDINGS' };
    }
    newBalance = balance.plus(grossAmount);
    const remainingQty = new Decimal(position.quantity).minus(qty);
    await positionRepository.update(
      {
        userId,
        assetId,
        quantity: money(remainingQty),
        averageBuyPrice: money(position.average_buy_price),
      },
      client
    );
  }

  const updatedWallet = await walletRepository.updateBalance(userId, money(newBalance), client);
  return { ok: true, wallet: updatedWallet, newBalance: money(newBalance) };
}

const orderService = {
  // Executes a MARKET order immediately at the current market price. The entire
  // operation runs in one transaction with the wallet row locked FOR UPDATE, so
  // concurrent orders from the same user serialize and can never over-draft.
  async placeMarketOrder({ userId, symbol, side, quantity }) {
    if (!userId || !symbol || !side || quantity === undefined) {
      throw new AppError('userId, symbol, side and quantity are required.', 400);
    }
    const normalizedSide = String(side).toUpperCase();
    if (!['BUY', 'SELL'].includes(normalizedSide)) {
      throw new AppError('side must be BUY or SELL.', 400);
    }
    let qty;
    try {
      qty = new Decimal(quantity);
    } catch (e) {
      throw new AppError('quantity must be a number.', 400);
    }
    if (qty.lte(0)) {
      throw new AppError('quantity must be greater than zero.', 400);
    }

    return withTransaction(async (client) => {
      // Resolve user, asset, and current price (reads can use the tx client).
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const asset = await assetRepository.findBySymbol(symbol, client);
      if (!asset || !asset.is_active) throw new AppError('Asset not found or inactive.', 404);

      const priceRaw = await assetRepository.getPrice(asset.id, client);
      if (priceRaw === null) throw new AppError('No market price available for this asset.', 422);
      const price = new Decimal(priceRaw);
      const grossAmount = price.times(qty); // total cash value of the trade

      // Wallet lock + funds/holdings check + position/wallet mutations happen here.
      const result = await settleFill(client, {
        userId, assetId: asset.id, side: normalizedSide, qty, price,
      });
      if (!result.ok) {
        throw new AppError(
          result.reason === 'INSUFFICIENT_FUNDS'
            ? 'Insufficient funds for this order.'
            : 'Insufficient asset holdings for this order.',
          422
        );
      }

      // Record the order as FILLED, then write the immutable ledger entry.
      const order = await orderRepository.create(
        {
          userId,
          assetId: asset.id,
          orderType: 'MARKET',
          side: normalizedSide,
          quantity: money(qty),
          targetPrice: null, // MARKET orders carry no target price (DB CHECK)
          status: 'FILLED',
        },
        client
      );

      const transaction = await transactionRepository.create(
        {
          userId,
          orderId: order.id,
          transactionType: normalizedSide,
          amount: money(grossAmount),
          pricePerShare: money(price),
        },
        client
      );

      return {
        order,
        transaction,
        wallet: result.wallet,
        executedPrice: money(price),
        totalAmount: money(grossAmount),
      };
    });
  },

  // Places a resting LIMIT order (status PENDING). No reservation: the wallet and
  // positions are untouched until the matcher fills it. Validation mirrors MARKET
  // plus a required, positive targetPrice.
  async placeLimitOrder({ userId, symbol, side, quantity, targetPrice }) {
    if (!userId || !symbol || !side || quantity === undefined) {
      throw new AppError('userId, symbol, side and quantity are required.', 400);
    }
    const normalizedSide = String(side).toUpperCase();
    if (!['BUY', 'SELL'].includes(normalizedSide)) {
      throw new AppError('side must be BUY or SELL.', 400);
    }
    let qty;
    try {
      qty = new Decimal(quantity);
    } catch (e) {
      throw new AppError('quantity must be a number.', 400);
    }
    if (qty.lte(0)) throw new AppError('quantity must be greater than zero.', 400);

    if (targetPrice === undefined || targetPrice === null || targetPrice === '') {
      throw new AppError('targetPrice is required for a LIMIT order.', 400);
    }
    let target;
    try {
      target = new Decimal(targetPrice);
    } catch (e) {
      throw new AppError('targetPrice must be a number.', 400);
    }
    if (target.lte(0)) throw new AppError('targetPrice must be greater than zero.', 400);

    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const asset = await assetRepository.findBySymbol(symbol, client);
      if (!asset || !asset.is_active) throw new AppError('Asset not found or inactive.', 404);

      return orderRepository.create(
        {
          userId,
          assetId: asset.id,
          orderType: 'LIMIT',
          side: normalizedSide,
          quantity: money(qty),
          targetPrice: money(target),
          status: 'PENDING',
        },
        client
      );
    });
  },

  // Fills one PENDING limit order in its own transaction. Locks the order row and
  // re-checks it is still PENDING and still crossed at the current market price
  // (guards against a concurrent fill/cancel), then settles at target_price.
  // Returns FILLED, REJECTED (shortfall) or SKIPPED (no longer eligible).
  async fillLimitOrder(orderId) {
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.status !== 'PENDING' || order.order_type !== 'LIMIT') return 'SKIPPED';

      const priceRaw = await assetRepository.getPrice(order.asset_id, client);
      if (priceRaw === null) return 'SKIPPED';
      const price = new Decimal(priceRaw);
      const target = new Decimal(order.target_price);
      const crossed = order.side === 'BUY' ? price.lte(target) : price.gte(target);
      if (!crossed) return 'SKIPPED';

      const qty = new Decimal(order.quantity);
      const result = await settleFill(client, {
        userId: order.user_id, assetId: order.asset_id, side: order.side, qty, price: target,
      });
      if (!result.ok) {
        await orderRepository.updateStatus(orderId, 'REJECTED', client);
        return 'REJECTED';
      }

      await orderRepository.updateStatus(orderId, 'FILLED', client);
      await transactionRepository.create(
        {
          userId: order.user_id,
          orderId,
          transactionType: order.side,
          amount: money(target.times(qty)),
          pricePerShare: money(target),
        },
        client
      );
      return 'FILLED';
    });
  },

  // Matcher entry point, called from the ingestion pipeline on each throttled
  // price update. Loads the symbol's PENDING limits, fills those crossed at
  // `price`. Pipeline-safe: never throws; per-order failures are logged.
  async processLimitOrdersForSymbol({ symbol, price }) {
    let filled = 0;
    let rejected = 0;
    try {
      const asset = await assetRepository.findBySymbol(symbol);
      if (!asset || !asset.is_active) return { filled, rejected };
      const p = new Decimal(price);

      const pending = await orderRepository.findPendingLimitByAsset(asset.id);
      for (const o of pending) {
        const target = new Decimal(o.target_price);
        const crossed = o.side === 'BUY' ? p.lte(target) : p.gte(target);
        if (!crossed) continue;
        try {
          const outcome = await orderService.fillLimitOrder(o.id);
          if (outcome === 'FILLED') filled += 1;
          else if (outcome === 'REJECTED') rejected += 1;
        } catch (err) {
          console.error(`Limit fill failed for order ${o.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`Limit matcher failed for ${symbol}:`, err.message);
    }
    return { filled, rejected };
  },

  async listOrders(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('User not found.', 404);
    return orderRepository.listByUser(userId);
  },
};

module.exports = orderService;
