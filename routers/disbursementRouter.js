const express = require('express');
const router = express.Router();
const disbCtrl = require('../controllers/disbursementController');
const authMiddleware = require('../middleware/authMiddleware');
const { rateLimitWithdrawal, rateLimitAuth } = require('../middleware/rateLimit');

router.post('/withdraw', authMiddleware, rateLimitWithdrawal, disbCtrl.requestWithdrawal);
router.get('/status/:referenceNo', authMiddleware, rateLimitAuth, disbCtrl.checkDisbursementStatus);
router.post('/webhook', disbCtrl.dokuWebhook); // ← no auth, dari Doku

module.exports = router;