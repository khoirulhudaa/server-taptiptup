// routers/donationRouter.js
const express = require('express');
const router = express.Router();
const donationCtrl = require('../controllers/donationController');
const authMiddleware = require('../middleware/authMiddleware');

// History donasi masuk ke akun streamer yang sedang login
// GET /api/donations/history?page=1&limit=50&status=PAID
router.get('/history', authMiddleware, donationCtrl.getDonationHistory);

// Statistik ringkasan donasi
// GET /api/donations/stats
router.get('/stats', authMiddleware, donationCtrl.getDonationStats);
router.get('/my-donations', authMiddleware, donationCtrl.getMyDonations);
router.get('/sent', authMiddleware, donationCtrl.getSentDonations);

module.exports = router;