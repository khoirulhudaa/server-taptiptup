// routers/authRouter.js — versi lengkap dengan fitur PIN & reset password
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const uploadImage = require('../middleware/imageUpload');
const { User } = require('../models');
const { rateLimitAuth, createRateLimit } = require('../middleware/rateLimit');

// Rate limit untuk login/register (bukan authenticated, jadi hanya IP)
const rateLimitAuthBasic = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 5,  // Lebih ketat untuk auth endpoints
  message: 'Terlalu banyak percobaan. Coba lagi dalam 1 menit.'
});

router.post('/register', rateLimitAuthBasic, authCtrl.register);
router.post('/login', rateLimitAuthBasic, authCtrl.login);
router.post('/verify-pin', rateLimitAuthBasic, authCtrl.verifyPin);
router.post('/forgot-password', rateLimitAuthBasic, authCtrl.forgotPassword);
router.post('/reset-password', rateLimitAuthBasic, authCtrl.resetPassword);
router.post('/verify-security-pin', rateLimitAuthBasic, authCtrl.verifySecurityPin); // baru
router.put('/change-pin', authMiddleware, authCtrl.changePin);
router.put('/regenerate-overlay-token', authMiddleware, rateLimitAuth, authCtrl.regenerateOverlayToken);
router.delete('/delete-account', authMiddleware, rateLimitAuthBasic, authCtrl.deleteAccount);

// Yang sudah login
router.put('/profile', authMiddleware, rateLimitAuth, authCtrl.updateProfile);
router.put('/change-password', authMiddleware, rateLimitAuth, authCtrl.changePassword);

router.post('/resend-pin',        authCtrl.resendPin);
router.get('/profile',            authMiddleware, authCtrl.getProfile);

router.post('/upload-profile-picture', 
  authMiddleware, 
  uploadImage.single('image'), 
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Tidak ada file yang diupload' });
      }

      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const imageUrl = `${baseUrl}/uploads/images/${req.file.filename}`;

      // Update profile picture di database
      await User.findByIdAndUpdate(req.user.id, { 
        profilePicture: imageUrl 
      });

      res.json({
        success: true,
        url: imageUrl,
        message: 'Foto profil berhasil diupload'
      });

    } catch (err) {
      console.error('Upload Profile Picture Error:', err);
      res.status(500).json({ 
        message: 'Gagal mengupload foto profil', 
        error: err.message 
      });
    }
  }
);

module.exports = router;