const express = require('express');
const orderController = require('../controllers/order.controller');
const validate = require('../middleware/validate');
const { placeOrderSchema } = require('../validation/schemas');

const router = express.Router();

router.post('/', validate(placeOrderSchema), orderController.place);
router.delete('/:id', orderController.cancel);
router.get('/user/:userId', orderController.listForUser);

module.exports = router;
