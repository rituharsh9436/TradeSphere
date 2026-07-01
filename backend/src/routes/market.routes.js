const express = require('express');
const marketController = require('../controllers/market.controller');

const router = express.Router();

router.get('/prices', marketController.getPrices);
router.get('/prices/:symbol', marketController.getPrice);
router.get('/candles', marketController.getCandles);

module.exports = router;
