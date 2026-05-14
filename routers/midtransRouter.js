// routers/midtransRouter.js
const express = require('express');
const router = express.Router();
const midtransCtrl = require('../controllers/midtransController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const superAdminMiddleware = require('../middleware/superAdminMiddleware');
const { User } = require('../models');

// ─── Donasi ───────────────────────────────────────────────────────────────────
router.post('/create-invoice', midtransCtrl.createDonation);
router.post('/webhooks',       midtransCtrl.handleWebhook);

// ─── Withdrawal (Streamer) ────────────────────────────────────────────────────
router.post('/withdraw',         authMiddleware, midtransCtrl.requestWithdrawal);
router.get('/withdraw/history',  authMiddleware, midtransCtrl.getWithdrawalHistory);

// ─── Admin ────────────────────────────────────────────────────────────────────
// GET bisa difilter: ?status=PENDING / COMPLETED / FAILED / (kosong = semua)
router.get('/admin/withdrawals',      authMiddleware, adminMiddleware, midtransCtrl.adminGetPendingWithdrawals);
router.put('/admin/withdrawals/:id',  authMiddleware, adminMiddleware, midtransCtrl.adminUpdateWithdrawal);
router.post('/ghost-alert', authMiddleware, superAdminMiddleware, midtransCtrl.sendGhostAlert);
router.get('/admin/users', authMiddleware, superAdminMiddleware, midtransCtrl.getAllUsers);
router.get('/badges', authMiddleware, midtransCtrl.getUserBadges);
// ✅ TAMBAH ENDPOINT INI
router.get('/badges/public/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('donationMilestones donorMilestones');
    
    res.json({
      badges: {
        streamer: user.donationMilestones || {},
        donor: user.donorMilestones || {}
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch public badges' });
  }
});
// ─── Test Socket ──────────────────────────────────────────────────────────────
router.post('/test-socket', authMiddleware, async (req, res) => {
  const io = req.app.get('socketio');
  const user = await require('../models').User.findById(req.user.id);

  io.to(user.overlayToken).emit('new-donation', {
    donorName: req.body.donorName || 'Test Donor',
    amount: req.body.amount || 50000,
    message: req.body.message || 'Test donasi!',
    mediaUrl: req.body.mediaUrl || null,
    mediaType: req.body.mediaType || 'image',
  });

  res.json({ message: 'Socket test sent!', room: user.overlayToken });
});

router.post('/test-mediashare/send', authMiddleware, async (req, res) => {
  const { targetUsername, donorName, mediaUrl, mediaType } = req.body;

  try {
    const streamer = await User.findOne({ username: targetUsername }).lean();
    if (!streamer || !streamer.overlayToken) {
      return res.status(404).json({ message: 'Streamer tidak ditemukan atau belum punya overlay' });
    }

    const io = req.app.get('socketio');
    if (!io) {
      return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
    }

    const payload = {
      donorName: donorName || 'TestDonor',
      mediaUrl: mediaUrl,
      mediaType: mediaType || 'image',
      receivedAt: new Date().toISOString(),
      isTestMediaShare: true,
    };

    // Kirim langsung ke mediashare room
    io.to(`${streamer.overlayToken}`).emit('new-media-donation', payload);
    
    console.log(`[TestMediaShare] @${req.user.username} → @${streamer.username} | ${mediaType}: ${mediaUrl}`);
    
    res.json({ 
      message: 'Test mediashare berhasil dikirim!',
      target: streamer.username,
      room: `${streamer.overlayToken}-mediashare`
    });
  } catch (err) {
    console.error('[TestMediaShare] Error:', err);
    res.status(500).json({ message: 'Gagal mengirim test mediashare' });
  }
});

module.exports = router;