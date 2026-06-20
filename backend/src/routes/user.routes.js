const express = require('express');
const userController = require('../controllers/user.controller');

const router = express.Router();

router.post('/', userController.register);
router.get('/:id', userController.getById);
router.get('/:id/wallet', userController.getWallet);

module.exports = router;
