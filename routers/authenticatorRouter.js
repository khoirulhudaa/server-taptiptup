const express = require('express');
const router = express.Router();
const twoFaCtrl = require('../controllers/twoFactorController');
const authMiddleware = require('../middleware/authMiddleware');
const { rateLimitAuth } = require('../middleware/rateLimit');

// ====================== GOOGLE AUTHENTICATOR ROUTES ======================
router.post('/enable-2fa', authMiddleware, rateLimitAuth, twoFaCtrl.enable2FA);
router.post('/verify-2fa', authMiddleware, rateLimitAuth, twoFaCtrl.verify2FA);
router.get('/2fa-status', authMiddleware, twoFaCtrl.get2FAStatus); // Optional: cek apakah 2FA sudah aktif

module.exports = router;