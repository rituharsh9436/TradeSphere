const express = require('express');
const meController = require('../controllers/me.controller');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { placeOrderSchema, deleteAccountSchema } = require('../validation/schemas');

const router = express.Router();

// Every /api/me route requires a valid token.
router.use(requireAuth);

router.get('/', meController.getMe);
router.get('/wallet', meController.getWallet);
router.get('/positions', meController.getPositions);
router.get('/portfolio', meController.getPortfolio);
router.get('/orders', meController.listOrders);
router.post('/orders', validate(placeOrderSchema), meController.placeOrder);
router.delete('/orders/:id', meController.cancelOrder);
router.post('/reset', meController.reset);
router.delete('/', validate(deleteAccountSchema), meController.deleteAccount);

module.exports = router;
