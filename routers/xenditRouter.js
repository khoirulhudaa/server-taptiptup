const express = require('express');
const router = express.Router();
const xenditCtrl = require('../controllers/xenditController');
const authMiddleware = require('../middleware/authMiddleware');

// Public — Donasi dari viewer
router.post('/create-invoice', xenditCtrl.createDonation);

// Webhook dari Xendit (tidak pakai auth, tapi validasi via x-callback-token di controller)
router.post('/webhooks', xenditCtrl.handleWebhook);
router.post('/webhooks/disbursement', xenditCtrl.handleDisbursementWebhook); // ← BARU: update status withdrawal

// Protected — Hanya streamer yang login
router.post('/withdraw', authMiddleware, xenditCtrl.requestWithdrawal);
router.get('/withdraw/history', authMiddleware, xenditCtrl.getWithdrawalHistory); // ← BARU: riwayat penarikan

module.exports = router;