// routers/marqueeRouter.js
const express = require('express');
const router = express.Router();
const { getTopDonors } = require('../controllers/marqueeController');

router.get('/:token/top-donors', getTopDonors);

module.exports = router;