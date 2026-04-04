const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');

// --- AUTH BASIC ---
router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);

// --- VERIFIKASI PIN (EMAIL) ---
// Rute untuk memasukkan PIN yang diterima di email
router.post('/verify-pin', authCtrl.verifyPin); 
// Rute untuk meminta PIN baru jika expired atau tidak masuk
router.post('/resend-pin', authCtrl.resendPin);

// --- FORGOT & RESET PASSWORD ---
router.post('/forgot-password', authCtrl.requestResetPassword);
router.post('/reset-password', authCtrl.resetPassword);

module.exports = router;