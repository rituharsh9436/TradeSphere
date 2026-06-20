const walletRepository = require('../repositories/wallet.repository');
const AppError = require('../utils/AppError');

// Business logic for wallet reads. Mutations during trading happen inside the
// (future) order service's transaction, which locks the row FOR UPDATE.
const walletService = {
  async getByUserId(userId) {
    const wallet = await walletRepository.findByUserId(userId);
    if (!wallet) {
      throw new AppError('Wallet not found for this user.', 404);
    }
    return wallet;
  },
};

module.exports = walletService;
