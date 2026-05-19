// routers/midtransRouter.js
const express = require('express');
const router = express.Router();
const midtransCtrl = require('../controllers/midtransController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const superAdminMiddleware = require('../middleware/superAdminMiddleware');
const { User, OverlaySetting, Donation } = require('../models');
const { donationQueue } = require('../utils/donationQueue');
const { getDisplayDuration } = require('../utils/helpers');

// ─── Donasi ───────────────────────────────────────────────────────────────────
router.post('/create-invoice', midtransCtrl.createDonation);
router.post('/webhooks',       midtransCtrl.handleWebhook);

// ─── Withdrawal (Streamer) ────────────────────────────────────────────────────
router.post('/withdraw',         authMiddleware, midtransCtrl.requestWithdrawal);
router.get('/withdraw/history',  authMiddleware, midtransCtrl.getWithdrawalHistory);
router.post('/mediashare/control', authMiddleware, async (req, res) => {
  const { action, volume } = req.body;
  // action: 'skip' | 'volume'
  const user = await User.findById(req.user.id).lean();
  if (!user?.overlayToken) return res.status(400).json({ message: 'No overlay token' });

  const io = req.app.get('socketio');
  io.to(`${user.overlayToken}-mediashare`).emit('mediashare-control', { action, volume });

  res.json({ success: true });
});
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
  const { targetUsername, donorName, amount, message, mediaUrl, mediaType } = req.body;

  const streamer = await User.findOne({ username: targetUsername }).lean();
  if (!streamer?.overlayToken) {
    return res.status(404).json({ message: 'Streamer tidak ditemukan' });
  }

  const io = req.app.get('socketio');
  const payload = {
    donorName: donorName || 'TestDonor',
    amount: amount || 25000,           // ✅ Bisa custom
    message: message || null,          // ✅ Bisa custom  
    mediaUrl,
    mediaType: mediaType || 'image',
    receivedAt: new Date().toISOString(),
    soundUrl: null,
    isTestMediaShare: true,
  };

  io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);
  
  console.log(`[TestMediaShare FULL] → ${payload.donorName} | Rp${payload.amount} | ${payload.mediaUrl}`);
  
  res.json({ 
    success: true,
    message: '✅ Test MediaShare lengkap terkirim!',
    preview: payload
  });
});

router.post('/replay-donation/:donationId', authMiddleware, async (req, res) => {
  const { donationId } = req.params;
  
  try {
    const donation = await Donation.findById(donationId)
      .populate('userId', 'username overlayToken')
      .lean();
    
    if (!donation) {
      return res.status(404).json({ message: 'Donasi tidak ditemukan' });
    }

    const streamer = donation.userId;
    if (!streamer?.overlayToken) {
      return res.status(400).json({ message: 'Streamer tidak memiliki overlay token' });
    }

    const io = req.app.get('socketio');
    if (!io) {
      return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
    }

    const payload = {
      donorName:  donation.donorName,
      amount:     donation.amount,
      message:    donation.message,
      mediaUrl:   donation.mediaUrl || null,
      mediaType:  donation.mediaType || null,
      voiceUrl:   donation.voiceUrl || null,
      receivedAt: new Date().toISOString(),
      soundUrl:   null,
      isReplay:   true,
    };

    // ✅ BYPASS QUEUE — langsung emit ke overlay
    // Replay tidak boleh ganggu antrian donasi real
    if (payload.voiceUrl && !payload.mediaUrl) {
      // Voice replay → emit ke room voice
      io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', payload);
    } else {
      // Alert/mediashare replay → emit langsung, skip queue
      io.to(streamer.overlayToken).emit('new-donation', payload);
    }

    console.log(`[Replay] DIRECT emit "${donation.donorName}" Rp${donation.amount} → @${streamer.username}`);

    res.json({
      success: true,
      message: 'Replay berhasil dikirim ke OBS!',
      donation: {
        donor:    donation.donorName,
        amount:   donation.amount,
        hasMedia: !!donation.mediaUrl,
      },
    });

  } catch (err) {
    console.error('[Replay Donation] Error:', err);
    res.status(500).json({ message: 'Gagal replay donasi', error: err.message });
  }
});

router.get('/available-balance', authMiddleware, midtransCtrl.getAvailableBalance);
router.post('/check-available', authMiddleware, midtransCtrl.checkAvailableBalance);

module.exports = router;