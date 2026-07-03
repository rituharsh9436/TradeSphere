const authService = require('../services/auth.service');
const catchAsync = require('../utils/catchAsync');

const authController = {
  register: catchAsync(async (req, res) => {
    const { username, email, password } = req.body;
    const result = await authService.register({ username, email, password });
    res.status(201).json({ status: 'success', data: result });
  }),

  login: catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    res.status(200).json({ status: 'success', data: result });
  }),
};

module.exports = authController;
