// routers/dokuPaymentRouter.js
const express = require('express');
const router = express.Router();
const dokuPaymentCtrl = require('../controllers/dokuPaymentController');
const authMiddleware = require('../middleware/authMiddleware');
const { rateLimitDonation } = require('../middleware/rateLimit');
require('dotenv').config();
const crypto = require('crypto');

// Donasi
router.post('/create-invoice', rateLimitDonation, dokuPaymentCtrl.createDonation);

// Webhook dari Doku (SUCCESS, FAILED, EXPIRED)
router.post('/webhook', dokuPaymentCtrl.handleWebhook);
router.post('/doku/inquiry',  dokuCtrl.handleInquiry);
router.post('/binding', dokuPaymentCtrl.handleBinding);
router.get('/binding',  dokuPaymentCtrl.handleBinding);
router.post('/qris/update-notify-url', authMiddleware, dokuPaymentCtrl.updateQrisNotifyUrl);

router.get('/debug-key', (req, res) => {
  const key = process.env.SBK_DOKU_SECRET_KEY;
  res.json({
    key,
    length: key?.length,
    chars: key?.split('').map((c, i) => ({ i, c, code: c.charCodeAt(0) }))
  });
});

router.get('/test-signature', async (req, res) => {
  const CLIENT_ID  = process.env.SBK_DOKU_CLIENT_ID;
  const SECRET_KEY = process.env.SBK_DOKU_SECRET_KEY;

  const requestId        = 'test-request-id-123';
  const requestTimestamp = '2026-06-06T09:33:57Z';
  const path             = '/checkout/v1/payment';
  const body             = { order: { invoice_number: 'INV-TEST-001', amount: 20000 }, payment: { payment_due_date: 60 } };

  const bodyString = JSON.stringify(body);
  const bodyHash   = crypto.createHash('sha256').update(bodyString).digest('base64');

  const componentSignature = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${path}`,
    `Digest:SHA-256=${bodyHash}`,
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(componentSignature)
    .digest('base64');

  res.json({
    CLIENT_ID,
    SECRET_KEY,
    SECRET_KEY_length: SECRET_KEY?.length,
    bodyHash,
    componentSignature,
    signature: `HMACSHA256=${signature}`,
  });
});

module.exports = router;