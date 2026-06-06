// routers/dokuPaymentRouter.js
const express = require('express');
const router = express.Router();
const dokuPaymentCtrl = require('../controllers/dokuPaymentController');
const authMiddleware = require('../middleware/authMiddleware');
const { rateLimitDonation } = require('../middleware/rateLimit');

// Donasi
router.post('/create-invoice', rateLimitDonation, dokuPaymentCtrl.createDonation);

// Webhook dari Doku (SUCCESS, FAILED, EXPIRED)
router.post('/webhook', dokuPaymentCtrl.handleWebhook);

module.exports = router;