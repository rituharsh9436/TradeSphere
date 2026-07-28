const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');
const { verifyPassword } = require('../utils/password');

// Business logic for user lifecycle. Creating a user also provisions their
// virtual wallet — both happen in one transaction so a user can never exist
// without a wallet.
const userService = {
  async getById(id) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found.', 404);
    }
    return user;
  },

  async list() {
    return userRepository.findAll();
  },

  async deleteAccount({ userId, password }) {
    if (!password) throw new AppError('Enter your password to delete this account.', 400);
    await withTransaction(async (client) => {
      const user = await userRepository.findAuthByIdForUpdate(userId, client);
      if (!user) throw new AppError('User not found.', 404);
      if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
        throw new AppError('Incorrect password. Your account was not deleted.', 400);
      }
      await userRepository.deleteAccount(userId, client);
    });
  },
};

module.exports = userService;
