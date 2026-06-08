
const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/marqueeController');
 
// GET /api/marquee/:token/top-donors?limit=10
router.get('/:token/top-donors', controller.getTopDonors);
router.get('/:token/recent', controller.getRecentDonations);

module.exports = router;