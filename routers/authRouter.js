// routers/authRouter.js — versi lengkap dengan fitur PIN & reset password
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// ── Auth Dasar ─────────────────────────────────────────────
router.post('/register',          authCtrl.register);
router.post('/login',             authCtrl.login);

// ── Verifikasi Email via PIN ───────────────────────────────
router.post('/verify-pin',        authCtrl.verifyPin);
router.post('/resend-pin',        authCtrl.resendPin);

// ── Forgot & Reset Password ────────────────────────────────
router.post('/forgot-password',   authCtrl.forgotPassword);
router.post('/reset-password',    authCtrl.resetPassword);

// ── Profile (butuh auth) ───────────────────────────────────
router.get('/profile',            authMiddleware, authCtrl.getProfile);
router.put('/profile',            authMiddleware, authCtrl.updateProfile);
router.put('/change-password',    authMiddleware, authCtrl.changePassword);

module.exports = router;