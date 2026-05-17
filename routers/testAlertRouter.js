// routers/testAlertRouter.js
const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/testAlertController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/send', authMiddleware, ctrl.sendInstantTestAlert);

module.exports = router;