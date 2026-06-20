const userRepository = require('../repositories/user.repository');
const walletRepository = require('../repositories/wallet.repository');
const withTransaction = require('../utils/withTransaction');
const AppError = require('../utils/AppError');

// Business logic for user lifecycle. Creating a user also provisions their
// virtual wallet — both happen in one transaction so a user can never exist
// without a wallet.
const userService = {
  async register({ username, email }) {
    if (!username || !email) {
      throw new AppError('username and email are required.', 400);
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw new AppError('A user with this email already exists.', 409);
    }

    return withTransaction(async (client) => {
      const user = await userRepository.create({ username, email }, client);
      const wallet = await walletRepository.create({ userId: user.id }, client);
      return { ...user, wallet };
    });
  },

  async getById(id) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found.', 404);
    }
    return user;
  },
};

module.exports = userService;
