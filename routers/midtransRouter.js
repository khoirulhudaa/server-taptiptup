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
const { default: mongoose } = require('mongoose');
const { spawn } = require('child_process');

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
  const { targetUsername, donorName, amount, message, mediaUrl, mediaType, startTime } = req.body;

  const streamer = await User.findOne({ username: targetUsername }).lean();
  if (!streamer?.overlayToken) {
    return res.status(404).json({ message: 'Streamer tidak ditemukan' });
  }

  const io = req.app.get('socketio');

  // ← Jangan convert, kirim raw — biarkan MediaShareOverlay yang handle
  const payload = {
    donorName:    donorName || 'TestDonor',
    amount:       Number(amount) || 25000,
    message:      message || null,
    mediaUrl:     mediaUrl || null,       // ← raw URL
    mediaType:    mediaType || 'image',
    startTime:    Number(startTime) || 0, // ← tambah startTime
    isMediaShare: true,                   // ← flag penting
    receivedAt:   new Date().toISOString(),
    soundUrl:     null,
    isTestMediaShare: true,
  };

  io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);

  console.log(`[TestMediaShare] → ${payload.donorName} | Rp${payload.amount} | ${payload.mediaUrl}`);

  res.json({ success: true, message: '✅ Test MediaShare terkirim!', preview: payload });
});

// router.post('/replay-donation/:donationId', authMiddleware, async (req, res) => {
//   const { donationId } = req.params;
  
//   try {
//     const donation = await Donation.findById(donationId)
//       .populate('userId', 'username overlayToken')
//       .lean();
    
//     if (!donation) {
//       return res.status(404).json({ message: 'Donasi tidak ditemukan' });
//     }

//     const streamer = donation.userId;
//     if (!streamer?.overlayToken) {
//       return res.status(400).json({ message: 'Streamer tidak memiliki overlay token' });
//     }

//     const io = req.app.get('socketio');
//     if (!io) {
//       return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
//     }

//     const resolvedMediaType = donation.mediaType || (() => {
//       if (!donation.mediaUrl) return null;
//       if (/youtube\.com|youtu\.be/.test(donation.mediaUrl)) return 'youtube';
//       if (/\.(mp4|webm|mov|ogg)/i.test(donation.mediaUrl)) return 'video';
//       return 'image';
//     })();

//     const payload = {
//       donorName:    donation.donorName,
//       amount:       donation.amount,
//       message:      donation.message,
//       mediaUrl:     donation.mediaUrl || null,
//       mediaType:    resolvedMediaType,          // ✅ pakai ini
//       voiceUrl:     donation.voiceUrl || null,
//       startTime:    donation.startTime || 0,
//       receivedAt:   new Date().toISOString(),
//       soundUrl:     null,
//       isReplay:     true,
//       isMediaShare: !!donation.mediaUrl && ['video', 'youtube'].includes(resolvedMediaType),
//     };

//     // ✅ GANTI LOGIC EMIT
//     if (payload.voiceUrl && !payload.mediaUrl) {
//       io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', payload);
//     } else if (payload.isMediaShare && payload.mediaUrl) {
//       // ✅ Media share → room yang benar
//       io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);
//     } else {
//       io.to(streamer.overlayToken).emit('new-donation', payload);
//     }

//     console.log(`[Replay] DIRECT emit "${donation.donorName}" Rp${donation.amount} → @${streamer.username}`);

//     res.json({
//       success: true,
//       message: 'Replay berhasil dikirim ke OBS!',
//       donation: {
//         donor:    donation.donorName,
//         amount:   donation.amount,
//         hasMedia: !!donation.mediaUrl,
//       },
//     });

//   } catch (err) {
//     console.error('[Replay Donation] Error:', err);
//     res.status(500).json({ message: 'Gagal replay donasi', error: err.message });
//   }
// });


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

    // ==================== IMPROVED MEDIA TYPE DETECTION ====================
    let resolvedMediaType = donation.mediaType;

    if (!resolvedMediaType && donation.mediaUrl) {
      const url = donation.mediaUrl.toLowerCase();

      if (/youtube\.com|youtu\.be/.test(url)) {
        resolvedMediaType = 'youtube';
      } 
      else if (/\.(mp4|webm|mov|ogg)/i.test(url)) {
        resolvedMediaType = 'video';
      } 
      else if (/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/.test(url)) {
        resolvedMediaType = 'tiktok';        // ← TAMBAHKAN INI
      } 
      else {
        resolvedMediaType = 'image';
      }
    }

    const payload = {
      donorName:    donation.donorName,
      amount:       donation.amount,
      message:      donation.message,
      mediaUrl:     donation.mediaUrl || null,
      mediaType:    resolvedMediaType,          // ← Sekarang support TikTok
      voiceUrl:     donation.voiceUrl || null,
      startTime:    donation.startTime || 0,
      receivedAt:   new Date().toISOString(),
      soundUrl:     null,
      isReplay:     true,
      isMediaShare: !!donation.mediaUrl && ['video', 'youtube', 'tiktok'].includes(resolvedMediaType),
    };

    // ✅ Emit Logic
    if (payload.voiceUrl && !payload.mediaUrl) {
      io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', payload);
    } 
    else if (payload.isMediaShare && payload.mediaUrl) {
      io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);
    } 
    else {
      io.to(streamer.overlayToken).emit('new-donation', payload);
    }

    console.log(`[Replay] ${resolvedMediaType?.toUpperCase() || 'NORMAL'} "${donation.donorName}" Rp${donation.amount} → @${streamer.username}`);

    res.json({
      success: true,
      message: 'Replay berhasil dikirim ke OBS!',
      donation: {
        donor:    donation.donorName,
        amount:   donation.amount,
        mediaType: resolvedMediaType,
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



// Tambah sementara di midtransRouter.js atau overlayRouter.js
// HAPUS setelah dijalankan sekali!

router.post('/admin/fix-user-balance/:userId', async (req, res) => {
  const { userId } = req.params;
  const { Donation, User } = require('../models');

  // Hitung ulang availableBalance dari donasi isAvailable = true
  const result = await Donation.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        status: 'PAID',
        isAvailable: true,
      }
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $cond: [
              { $gt: ['$streamerReceive', 0] },
              '$streamerReceive',
              '$amount'
            ]
          }
        }
      }
    }
  ]);

  const correctAvailable = result[0]?.total || 0;
  const user = await User.findById(userId);

  // Pastikan tidak melebihi walletBalance
  const finalAvailable = Math.min(correctAvailable, user.walletBalance);

  await User.findByIdAndUpdate(userId, {
    $set: { availableBalance: finalAvailable }
  });

  res.json({
    userId,
    walletBalance:        user.walletBalance,
    computedAvailable:    correctAvailable,
    finalAvailableSet:    finalAvailable,
    pendingBalance:       user.walletBalance - finalAvailable,
  });
});

// GET /api/tiktok-resolve?url=https://vt.tiktok.com/ZSxHCHVqL/
router.get('/tiktok-resolve', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        'Referer': 'https://www.tiktok.com/',
      },
    });

    const finalUrl = response.url;
    console.log(`[TikTok Resolve] ${url} → ${finalUrl}`);

    const match = finalUrl.match(/tiktok\.com\/@[\w.]+\/video\/(\d+)/);
    if (!match) {
      return res.json({ resolved: false, reason: 'Video ID tidak ditemukan' });
    }

    return res.json({
      resolved: true,
      videoId: match[1],
      fullUrl: finalUrl.split('?')[0], // ← buang query params biar bersih
      embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
    });
  } catch (err) {
    console.error('[TikTok Resolve] Error:', err.message);
    return res.status(500).json({ resolved: false, reason: 'Gagal resolve URL' });
  }
});


router.get('/tiktok-stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // Step 1: ambil direct CDN URL dulu (cepat, ~1-2 detik)
    const getUrl = spawn('yt-dlp', [
      '--get-url',
      '--no-playlist',
      '-f', 'mp4',   // format mp4
      url
    ]);

    let directUrl = '';
    let errOut = '';

    getUrl.stdout.on('data', (d) => { directUrl += d.toString(); });
    getUrl.stderr.on('data', (d) => { errOut += d.toString(); });

    getUrl.on('close', (code) => {
      directUrl = directUrl.trim().split('\n')[0];

      if (code !== 0 || !directUrl) {
        console.error('[TikTok Stream] yt-dlp error:', errOut);
        return res.status(500).json({ error: 'Gagal ambil URL video TikTok' });
      }

      // Step 2: redirect ke CDN URL — browser fetch langsung dari TikTok CDN
      // URL CDN TikTok valid ~1 jam
      console.log('[TikTok Stream] Redirect ke CDN:', directUrl.substring(0, 80) + '...');
      res.redirect(302, directUrl);
    });

  } catch (err) {
    console.error('[TikTok Stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;