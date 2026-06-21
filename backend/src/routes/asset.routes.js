const express = require('express');
const assetController = require('../controllers/asset.controller');

const router = express.Router();

router.get('/', assetController.list);

module.exports = router;
