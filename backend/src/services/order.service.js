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

      // Lock the wallet row — the serialization point for all of this user's trades.
      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      if (!wallet) throw new AppError('Wallet not found for this user.', 404);
      const balance = new Decimal(wallet.balance);

      let newBalance;
      let position = await positionRepository.findForUpdate(userId, asset.id, client);

      if (normalizedSide === 'BUY') {
        if (balance.lt(grossAmount)) {
          throw new AppError('Insufficient funds for this order.', 422);
        }
        newBalance = balance.minus(grossAmount);

        // Update holding with a new quantity-weighted average buy price.
        if (position) {
          const oldQty = new Decimal(position.quantity);
          const oldCost = oldQty.times(position.average_buy_price);
          const newQty = oldQty.plus(qty);
          const newAvg = oldCost.plus(grossAmount).div(newQty);
          await positionRepository.update(
            { userId, assetId: asset.id, quantity: money(newQty), averageBuyPrice: money(newAvg) },
            client
          );
        } else {
          await positionRepository.create(
            { userId, assetId: asset.id, quantity: money(qty), averageBuyPrice: money(price) },
            client
          );
        }
      } else {
        // SELL
        if (!position || new Decimal(position.quantity).lt(qty)) {
          throw new AppError('Insufficient asset holdings for this order.', 422);
        }
        newBalance = balance.plus(grossAmount);

        const remainingQty = new Decimal(position.quantity).minus(qty);
        // Average buy price is unchanged on a sell; quantity simply decreases.
        await positionRepository.update(
          {
            userId,
            assetId: asset.id,
            quantity: money(remainingQty),
            averageBuyPrice: money(position.average_buy_price),
          },
          client
        );
      }

      // Persist the new wallet balance.
      const updatedWallet = await walletRepository.updateBalance(userId, money(newBalance), client);

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
        wallet: updatedWallet,
        executedPrice: money(price),
        totalAmount: money(grossAmount),
      };
    });
  },

  async listOrders(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw new AppError('User not found.', 404);
    return orderRepository.listByUser(userId);
  },
};

module.exports = orderService;
