const Decimal = require('decimal.js');

const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const orderRepository = require('../repositories/order.repository');
const positionRepository = require('../repositories/position.repository');
const assetRepository = require('../repositories/asset.repository');
const transactionRepository = require('../repositories/transaction.repository');

// DECIMAL(15,4) in the schema — keep all monetary values at 4 dp.
const SCALE = 4;
const money = (value) => new Decimal(value).toFixed(SCALE);
// The wallet's fixed starting cash (no deposits exist); reset restores exactly this.
const STARTING_CAPITAL = '100000';

const resetService = {
  // Panic button: liquidate all positions, cancel all pending orders, and force
  // the wallet back to the starting balance — atomically, with the wallet locked
  // FOR UPDATE first so a reset never interleaves with a concurrent order fill.
  // The ledger is append-only: we INSERT one RESET row per liquidated position
  // (valued at market, or the position's average_buy_price when the feed is quiet)
  // and never touch prior history.
  async resetAccount({ userId }) {
    if (!userId) throw new AppError('userId is required.', 400);

    return withTransaction(async (client) => {
      const user = await userRepository.findById(userId, client);
      if (!user) throw new AppError('User not found.', 404);

      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      if (!wallet) throw new AppError('Wallet not found for this user.', 404);

      // 1) Cancel every PENDING order.
      const cancelled = await orderRepository.cancelAllPendingByUser(userId, client);

      // 2) Liquidate every open position into a RESET ledger row, then zero it.
      const positions = await positionRepository.findByUser(userId, client);
      const resetTransactions = [];
      for (const position of positions) {
        const marketPrice = await assetRepository.getPrice(position.asset_id, client);
        const price = new Decimal(marketPrice ?? position.average_buy_price);
        const qty = new Decimal(position.quantity);

        const tx = await transactionRepository.create(
          {
            userId,
            orderId: null,
            transactionType: 'RESET',
            amount: money(price.times(qty)),
            pricePerShare: money(price),
          },
          client
        );
        resetTransactions.push(tx);

        await positionRepository.update(
          {
            userId,
            assetId: position.asset_id,
            quantity: money(0),
            averageBuyPrice: money(position.average_buy_price),
          },
          client
        );
      }

      // 3) Restore the wallet to the fixed starting balance.
      const updatedWallet = await walletRepository.updateBalance(
        userId,
        money(STARTING_CAPITAL),
        client
      );

      return {
        wallet: updatedWallet,
        positionsLiquidated: positions.length,
        ordersCancelled: cancelled.length,
        resetTransactions,
      };
    });
  },
};

module.exports = resetService;
