const express = require('express');
const orderController = require('../controllers/order.controller');

const router = express.Router();

router.post('/', orderController.placeMarket);
router.get('/user/:userId', orderController.listForUser);

module.exports = router;
