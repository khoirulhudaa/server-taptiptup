// routers/widgetRouter.js
const express = require('express');
const router = express.Router();
const widgetCtrl = require('../controllers/widgetController');

router.get('/:token/milestones',  widgetCtrl.milestones);
router.get('/:token/leaderboard', widgetCtrl.leaderboard);
router.get('/:token/qrcode',      widgetCtrl.qrcode);

module.exports = router;