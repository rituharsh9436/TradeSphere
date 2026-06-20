const userService = require('../services/user.service');
const walletService = require('../services/wallet.service');
const catchAsync = require('../utils/catchAsync');

// Thin HTTP adapters: parse the request, call the service, shape the response.
// No business logic lives here.
const userController = {
  register: catchAsync(async (req, res) => {
    const { username, email } = req.body;
    const user = await userService.register({ username, email });
    res.status(201).json({ status: 'success', data: user });
  }),

  getById: catchAsync(async (req, res) => {
    const user = await userService.getById(req.params.id);
    res.status(200).json({ status: 'success', data: user });
  }),

  getWallet: catchAsync(async (req, res) => {
    const wallet = await walletService.getByUserId(req.params.id);
    res.status(200).json({ status: 'success', data: wallet });
  }),
};

module.exports = userController;
