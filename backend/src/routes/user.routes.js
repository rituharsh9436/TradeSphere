const express = require('express');
const userController = require('../controllers/user.controller');

const router = express.Router();

router.post('/', userController.register);
router.get('/:id', userController.getById);
router.get('/:id/wallet', userController.getWallet);
router.get('/:id/positions', userController.getPositions);
router.get('/:id/portfolio', userController.getPortfolio);

module.exports = router;
