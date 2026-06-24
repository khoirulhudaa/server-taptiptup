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
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  const { rateLimitDonation, rateLimitAuth, rateLimitWithdrawal } = require('../middleware/rateLimit');
  const { isSoundCloudUrl, resolveSoundCloudTrack } = require('../utils/soundcloud');
  const axios = require('axios');

  // Folder temp upload
  const TEMP_DIR = path.join(__dirname, '../temp-uploads');
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TEMP_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `temp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
    fileFilter: (req, file, cb) => {
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.includes(ext)) {
        return cb(new Error('Hanya gambar yang diizinkan (jpg, png, gif, webp)'));
      }
      cb(null, true);
    },
  });

  // ─── Donasi ───────────────────────────────────────────────────────────────────
  router.post('/create-invoice', midtransCtrl.createDonation);
  router.get('/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const donation = await Donation.findOne({ externalId: orderId }).lean();
    if (!donation) return res.status(404).json({ message: 'Donasi tidak ditemukan' });

    res.json({ transaction_status: donation.status === 'PAID' ? 'settlement' : donation.status.toLowerCase() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
  router.post('/webhooks',       midtransCtrl.handleWebhook);
  router.post('/enable-2fa', authMiddleware, midtransCtrl.enable2FA);
  router.get('/2fa-status', authMiddleware, midtransCtrl.get2FAStatus);
  router.post('/verify-2fa', authMiddleware, midtransCtrl.verify2FA);

  // Helper konversi ISO 8601 ("PT3M45S") -> detik
  function parseISO8601Duration(iso) {
    if (!iso) return null;
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;
    const hours   = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  router.get('/youtube-search', rateLimitAuth, async (req, res) => {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Ketik minimal 2 karakter' });
    }

    try {
      const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key: process.env.YOUTUBE_API_KEY,
          q: q.trim(),
          part: 'snippet',
          type: 'video',
          videoCategoryId: '10',
          maxResults: 6,
          regionCode: 'ID',
          relevanceLanguage: 'id',
        },
        timeout: 7000,
      });

      const items = searchResponse.data.items;
      const videoIds = items.map(item => item.id.videoId).join(',');

      // Ambil durasi semua video sekaligus (1 request, hemat quota)
      const detailsResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          key: process.env.YOUTUBE_API_KEY,
          id: videoIds,
          part: 'contentDetails',
        },
        timeout: 7000,
      });

      // Map videoId -> durasi dalam detik
      const durationMap = {};
      for (const video of detailsResponse.data.items) {
        durationMap[video.id] = parseISO8601Duration(video.contentDetails.duration);
      }

      const tracks = items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        artworkUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        permalinkUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        videoId: item.id.videoId,
        duration: durationMap[item.id.videoId] || null,
      }));

      res.json({ success: true, tracks });
    } catch (err) {
      console.error('[YouTube Search Error]', err.message);
      res.status(500).json({ message: 'Gagal mencari lagu. Coba lagi.' });
    }
  });

  // ─── Withdrawal (Streamer) ────────────────────────────────────────────────────
  router.post('/withdraw', authMiddleware, midtransCtrl.withdrawRateLimiter, midtransCtrl.requestWithdrawal, midtransCtrl.requestWithdrawal);
  router.get('/withdraw/history', authMiddleware, rateLimitAuth, midtransCtrl.getWithdrawalHistory);
  // Route baru: GET /api/mediashare/shortcut/:token/:action
  // Pakai overlayToken sebagai auth (bukan JWT) karena Stream Deck tidak bisa kirim header
  router.get('/mediashare/shortcut/:token/:action', rateLimitAuth, async (req, res) => {
    const { token, action } = req.params;
    const volume = req.query.volume ? Number(req.query.volume) : undefined;

    // Validasi action
    const ALLOWED_ACTIONS = ['skip', 'volume', 'mute', 'unmute'];
    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    // Cari user via overlayToken (bukan JWT)
    const user = await User.findOne({ overlayToken: token }).lean();
    if (!user) return res.status(404).json({ message: 'Invalid token' });

    const io = req.app.get('socketio');
    io.to(`${token}-mediashare`).emit('mediashare-control', { action, volume });

    // Bisa juga return HTML sederhana supaya Stream Deck "website" action tidak error
    res.json({ success: true, action, timestamp: Date.now() });
  });
  
  router.post('/mediashare/control', authMiddleware, rateLimitAuth, async (req, res) => {
    const { action, volume } = req.body;
    // action: 'skip' | 'volume'
    const user = await User.findById(req.user.id).lean();
    if (!user?.overlayToken) return res.status(400).json({ message: 'No overlay token' });

    const io = req.app.get('socketio');
    io.to(`${user.overlayToken}-mediashare`).emit('mediashare-control', { action, volume });

    res.json({ success: true });
  });

  router.post('/song-skip', authMiddleware, async (req, res) => {
    const { overlayToken } = req.body;
    
    // Verifikasi token milik user yang request
    const user = await User.findById(req.user.id).lean();
    if (!user || user.overlayToken !== overlayToken) {
      return res.status(403).json({ message: 'Token tidak valid' });
    }

    const io = req.app.get('socketio');
    io.to(overlayToken).emit('song-skip');
    
    console.log(`[SongSkip] ⏭ @${user.username} skip lagu`);
    res.json({ success: true });
  });

  router.get('/song-shortcut/:token/:action', rateLimitAuth, async (req, res) => {
    const { token, action } = req.params;
    const ALLOWED_ACTIONS = ['skip'];

    if (!ALLOWED_ACTIONS.includes(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }

    const user = await User.findOne({ overlayToken: token }).lean();
    if (!user) return res.status(404).json({ message: 'Invalid token' });

    const io = req.app.get('socketio');
    io.to(token).emit('song-skip');

    console.log(`[SongSkip-StreamDeck] ⏭ @${user.username} skip lagu via shortcut URL`);
    res.json({ success: true, action, timestamp: Date.now() });
  });

  // ─── Admin ────────────────────────────────────────────────────────────────────
  // GET bisa difilter: ?status=PENDING / COMPLETED / FAInvLED / (kosong = semua)
  router.get('/admin/withdrawals', authMiddleware, adminMiddleware, rateLimitAuth, midtransCtrl.adminGetPendingWithdrawals);
  router.put('/admin/withdrawals/:id', authMiddleware, adminMiddleware, rateLimitAuth, midtransCtrl.adminUpdateWithdrawal);
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
    const { 
      targetUsername, donorName, amount, message, 
      mediaUrl, mediaType, startTime,
      donationItem  // ← TAMBAH INI
    } = req.body;

    const streamer = await User.findOne({ username: targetUsername }).lean();
    if (!streamer?.overlayToken) {
      return res.status(404).json({ message: 'Streamer tidak ditemukan' });
    }

    const io = req.app.get('socketio');

    const payload = {
      donorName:    donorName || 'TestDonor',
      amount:       Number(amount) || 25000,
      message:      message || null,
      mediaUrl:     mediaUrl || null,
      mediaType:    mediaType || 'image',
      startTime:    Number(startTime) || 0,
      isMediaShare: true,
      receivedAt:   new Date().toISOString(),
      soundUrl:     null,
      isTestMediaShare: true,
      donationItem: donationItem || null,  // ← TAMBAH INI
    };

    io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);

    console.log(`[TestMediaShare] → ${payload.donorName} | Rp${payload.amount} | ${payload.mediaUrl}`);

    res.json({ success: true, message: '✅ Test MediaShare terkirim!', preview: payload });
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
        isMediaShare: !!donation.mediaUrl && ['video', 'youtube', 'tiktok', 'image'].includes(resolvedMediaType),
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

  // Upload endpoint
  router.post('/temp-upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });

    const fileUrl = `${process.env.BASE_URL || 'https://server-ttt-production.up.railway.app'}/temp-uploads/${req.file.filename}`;

    // Auto-delete setelah 15 menit
    setTimeout(() => {
      fs.unlink(req.file.path, (err) => {
        if (err) console.warn('[TempUpload] Gagal hapus:', req.file.filename);
        else console.log('[TempUpload] Terhapus:', req.file.filename);
      });
    }, 15 * 60 * 1000);

    console.log(`[TempUpload] ✅ ${req.file.filename} — akan dihapus dalam 15 menit`);
    res.json({ url: fileUrl, expiresIn: '15 minutes' });
  });

  // GET /api/midtrans/admin/donation-logs
  router.get('/admin/donation-logs', authMiddleware, superAdminMiddleware, async (req, res) => {
    const { 
      streamer = 'all', 
      limit = 100, 
      status = '', 
      startDate, 
      endDate 
    } = req.query;

    try {
      const filter = {};

      if (status) filter.status = status;

      // === DATE RANGE FILTER (Improved) ===
      if (startDate || endDate) {
        filter.createdAt = {};

        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);           // Mulai dari jam 00:00:00
          filter.createdAt.$gte = start;
        }

        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);        // Sampai jam 23:59:59.999
          filter.createdAt.$lte = end;          // Gunakan $lte bukan $lt
        }
      }

      if (streamer !== 'all') {
        const user = await User.findOne({ username: streamer }).lean();
        if (!user) return res.status(404).json({ message: 'Streamer tidak ditemukan' });
        filter.userId = user._id;
      }

      const donations = await Donation.find(filter)
        .populate('userId', 'username email overlayToken')
        .populate('donorUserId', 'username')
        .sort({ createdAt: -1 })
        .limit(Number(limit) || 100)
        .lean();

      res.json({ 
        donations, 
        total: donations.length,
        filter: { startDate, endDate } // untuk debugging
      });
    } catch (err) {
      console.error('[AdminDonationLogs] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/midtrans/admin/streamers-list — untuk dropdown
  router.get('/admin/streamers-list', authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
      const users = await User.find({ role: { $ne: 'superAdmin' } })
        .select('username email totalDonations totalDonationCount walletBalance')
        .sort({ totalDonations: -1 })
        .lean();
      res.json({ users });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  module.exports = router;