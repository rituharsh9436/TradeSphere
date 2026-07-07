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
  // Quantize to the 4-dp money scale up front so the wallet debit/credit and the
  // ledger row are computed from the exact same value (keeps sum(ledger) ==
  // wallet delta; qty is already quantized by the callers).
  const grossAmount = new Decimal(money(new Decimal(price).times(qty)));

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
  // Single entry point for placing an order from any surface. Normalizes and
  // validates orderType, dispatches to the MARKET/LIMIT/ADVANCED executor, and
  // returns the response `data` shape (LIMIT/ADVANCED are wrapped as { order }
  // since they only rest). Both /api/orders and /api/me/orders delegate here so
  // the two never drift.
  async place({
    userId, symbol, side, quantity, orderType, targetPrice,
    advancedType, triggerPrice, trailAmount, trailPercent, timeInForce,
  }) {
    const type = orderType ? String(orderType).toUpperCase() : 'MARKET';
    if (!['MARKET', 'LIMIT', 'ADVANCED'].includes(type)) {
      throw new AppError('orderType must be MARKET, LIMIT, or ADVANCED.', 400);
    }
    if (type === 'LIMIT') {
      return {
        order: await orderService.placeLimitOrder({ userId, symbol, side, quantity, targetPrice }),
      };
    }
    if (type === 'ADVANCED') {
      return {
        order: await orderService.placeAdvancedOrder({
          userId, symbol, side, quantity,
          advancedType, triggerPrice, trailAmount, trailPercent, timeInForce,
        }),
      };
    }
    return orderService.placeMarketOrder({ userId, symbol, side, quantity });
  },

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
    qty = new Decimal(money(qty)); // quantize to 4 dp so stored shares == cash charged
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
      const grossAmount = new Decimal(money(price.times(qty))); // 4 dp cash value of the trade

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
    qty = new Decimal(money(qty)); // quantize to 4 dp
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
    target = new Decimal(money(target)); // quantize to 4 dp
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

  // Places a resting ADVANCED order (status PENDING). Like LIMIT it does not
  // touch the wallet or positions; the matcher fills it later when the trigger
  // condition is crossed. Validation enforces the spec rules for each
  // advanced_type so bad orders are rejected client-side at /api/orders.
  async placeAdvancedOrder({
    userId, symbol, side, quantity,
    advancedType, triggerPrice, trailAmount, trailPercent, timeInForce,
  }) {
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
    qty = new Decimal(money(qty));
    if (qty.lte(0)) throw new AppError('quantity must be greater than zero.', 400);

    if (!advancedType) {
      throw new AppError('advancedType is required for an ADVANCED order.', 400);
    }
    const normalizedAdvancedType = String(advancedType).toUpperCase();
    if (!['STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'].includes(normalizedAdvancedType)) {
      throw new AppError('advancedType must be STOP_LOSS, TAKE_PROFIT, or TRAILING_STOP.', 400);
    }

    let tif = timeInForce ? String(timeInForce).toUpperCase() : 'DAY';
    if (!['DAY', 'GTC'].includes(tif)) {
      throw new AppError('timeInForce must be DAY or GTC.', 400);
    }

    // Per-type numeric fields. STOP_LOSS and TAKE_PROFIT need a numeric
    // trigger_price; TRAILING_STOP uses exactly one of trail_amount /
    // trail_percent (the other may be null).
    let trigger = null;
    if (normalizedAdvancedType === 'STOP_LOSS' || normalizedAdvancedType === 'TAKE_PROFIT') {
      if (triggerPrice === undefined || triggerPrice === null || triggerPrice === '') {
        throw new AppError('triggerPrice is required for STOP_LOSS and TAKE_PROFIT orders.', 400);
      }
      try {
        trigger = new Decimal(triggerPrice);
      } catch (e) {
        throw new AppError('triggerPrice must be a number.', 400);
      }
      trigger = new Decimal(money(trigger));
      if (trigger.lte(0)) throw new AppError('triggerPrice must be greater than zero.', 400);
    }

    let parsedTrailAmount = null;
    let parsedTrailPercent = null;
    if (normalizedAdvancedType === 'TRAILING_STOP') {
      const hasAmount = trailAmount !== undefined && trailAmount !== null && trailAmount !== '';
      const hasPercent = trailPercent !== undefined && trailPercent !== null && trailPercent !== '';
      if (!hasAmount && !hasPercent) {
        throw new AppError('TRAILING_STOP requires trail_amount or trail_percent.', 400);
      }
      if (hasAmount && hasPercent) {
        throw new AppError('TRAILING_STOP accepts only one of trail_amount or trail_percent.', 400);
      }
      if (hasAmount) {
        let amount;
        try {
          amount = new Decimal(trailAmount);
        } catch (e) {
          throw new AppError('trail_amount must be a number.', 400);
        }
        if (amount.lte(0)) throw new AppError('trail_amount must be greater than zero.', 400);
        parsedTrailAmount = money(amount);
      }
      if (hasPercent) {
        let percent;
        try {
          percent = new Decimal(trailPercent);
        } catch (e) {
          throw new AppError('trail_percent must be a number.', 400);
        }
        if (percent.lte(0) || percent.gte(100)) {
          throw new AppError('trail_percent must be between 0 and 100 (exclusive).', 400);
        }
        parsedTrailPercent = percent.toFixed(2);
      }
    }

    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const asset = await assetRepository.findBySymbol(symbol, client);
      if (!asset || !asset.is_active) throw new AppError('Asset not found or inactive.', 404);

      // Need a current price for both the directional validation rules
      // (trigger vs spot) and to seed the trailing stop high-water-mark.
      const priceRaw = await assetRepository.getPrice(asset.id, client);
      if (priceRaw === null) {
        throw new AppError('No market price available for this asset.', 422);
      }
      const currentPrice = new Decimal(priceRaw);

      // Directional validation. For SELL the trigger sits on the side of the
      // current price that makes a protective or profit-taking exit sensible;
      // for BUY we mirror it. TRAILING_STOP gets only the positive-amount
      // check above (its trigger migrates with the high-water-mark, so a
      // static cross-check would be wrong).
      if (normalizedSide === 'SELL') {
        if (normalizedAdvancedType === 'STOP_LOSS' && trigger.gte(currentPrice)) {
          throw new AppError('Stop-loss trigger must be below current market price for SELL.', 400);
        }
        if (normalizedAdvancedType === 'TAKE_PROFIT' && trigger.lte(currentPrice)) {
          throw new AppError('Take-profit trigger must be above current market price for SELL.', 400);
        }
      }
      if (normalizedSide === 'BUY') {
        if (normalizedAdvancedType === 'STOP_LOSS' && trigger.lte(currentPrice)) {
          throw new AppError('Stop-loss trigger must be above current market price for BUY.', 400);
        }
        if (normalizedAdvancedType === 'TAKE_PROFIT' && trigger.gte(currentPrice)) {
          throw new AppError('Take-profit trigger must be below current market price for BUY.', 400);
        }
      }

      // For trailing stops the seed trigger_price is undefined at creation;
      // the matcher computes it on each favorable tick. For STOP_LOSS and
      // TAKE_PROFIT the trigger_price is the literal threshold.
      let initialTrigger =
        normalizedAdvancedType === 'TRAILING_STOP' ? null : trigger.toFixed(SCALE);

      const advancedParams = {
        advanced_type: normalizedAdvancedType,
        trigger_price: initialTrigger,
        trail_amount: parsedTrailAmount,
        trail_percent: parsedTrailPercent,
        high_water_mark: money(currentPrice),
        time_in_force: tif,
      };

      return orderRepository.create(
        {
          userId,
          assetId: asset.id,
          orderType: 'ADVANCED',
          side: normalizedSide,
          quantity: money(qty),
          targetPrice: null,
          status: 'PENDING',
          advancedParams,
        },
        client
      );
    });
  },

  // Fills one PENDING limit order in its own transaction. Locks the order row and
  // re-checks it is still PENDING and still crossed at the current market price
  // (guards against a concurrent fill/cancel), then settles at target_price.
  // Returns FILLED, REJECTED (shortfall) or SKIPPED (no longer eligible).
  async fillLimitOrder(orderId, referencePrice = null) {
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.status !== 'PENDING' || order.order_type !== 'LIMIT') return 'SKIPPED';

      // Decide crossing against the triggering tick price when the matcher supplies
      // it; fall back to the latest stored price for standalone calls. Re-reading
      // market_prices can lag the tick that triggered this fill (the price write is
      // not awaited before matching), which would spuriously SKIP a crossed order.
      let price;
      if (referencePrice !== null && referencePrice !== undefined) {
        price = new Decimal(referencePrice);
      } else {
        const priceRaw = await assetRepository.getPrice(order.asset_id, client);
        if (priceRaw === null) return 'SKIPPED';
        price = new Decimal(priceRaw);
      }
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
          const outcome = await orderService.fillLimitOrder(o.id, p);
          if (outcome === 'FILLED') filled += 1;
          else if (outcome === 'REJECTED') rejected += 1;
        } catch (err) {
          console.error(`Limit fill failed for order ${o.id}:`, err.message);
        }
      }

      // Also evaluate advanced orders
      const { evaluateAdvancedOrders } = require('./advancedOrderMatcher');
      await evaluateAdvancedOrders(asset.id, price);

    } catch (err) {
      console.error(`Limit matcher failed for ${symbol}:`, err.message);
    }
    return { filled, rejected };
  },

  // Fills a triggered advanced order as a MARKET order at the current market price.
  // Re-uses settleFill with the current market price, exactly like placeMarketOrder.
  // Locks the order row and verifies it is still PENDING and ADVANCED.
  async fillTriggeredOrder(orderId, referencePrice) {
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.status !== 'PENDING' || order.order_type !== 'ADVANCED') return 'SKIPPED';

      const price = new Decimal(referencePrice);
      const qty = new Decimal(order.quantity);
      const grossAmount = new Decimal(money(price.times(qty)));

      const result = await settleFill(client, {
        userId: order.user_id, assetId: order.asset_id, side: order.side, qty, price,
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
          amount: money(grossAmount),
          pricePerShare: money(price),
        },
        client
      );
      return 'FILLED';
    });
  },

  // Cancels a still-PENDING order. Locks the row and verifies ownership + status
  // before flipping to CANCELLED, so it can't race a concurrent fill.
  async cancelOrder({ orderId, userId }) {
    if (!userId) throw new AppError('userId query parameter is required.', 400);
    return withTransaction(async (client) => {
      const order = await orderRepository.findByIdForUpdate(orderId, client);
      if (!order || order.user_id !== userId) throw new AppError('Order not found.', 404);
      if (order.status !== 'PENDING') {
        throw new AppError('Only pending orders can be cancelled.', 409);
      }
      return orderRepository.updateStatus(orderId, 'CANCELLED', client);
    });
  },

  async listOrders(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('User not found.', 404);
    return orderRepository.listByUser(userId);
  },
};

module.exports = orderService;
