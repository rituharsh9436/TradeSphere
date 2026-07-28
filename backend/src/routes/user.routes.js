const express = require('express');
const userController = require('../controllers/user.controller');

const router = express.Router();


router.get('/', userController.list);
router.get('/:id', userController.getById);
router.get('/:id/wallet', userController.getWallet);
router.get('/:id/positions', userController.getPositions);
router.get('/:id/portfolio', userController.getPortfolio);
router.post('/:id/reset', userController.reset);

module.exports = router;
