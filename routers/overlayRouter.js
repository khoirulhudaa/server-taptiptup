// routers/overlayRouter.js
const express = require('express');
const router = express.Router();
const overlayCtrl = require('../controllers/overlayController');
const authMiddleware = require('../middleware/authMiddleware');
const ttsCtrl = require('../controllers/ttsController');
const { audioUpload } = require('../middleware/multerConfig');
const { proxyAudio } = require('../utils/proxyAudio');
const upload = require('../middleware/audioUpload');


// ========== TAMBAHKAN ini ==========
const { rateLimitAuth, createRateLimit } = require('../middleware/rateLimit');
const { Donation, User } = require('../models');

// Rate limit untuk upload (PUBLIK - IP saja)
const rateLimitUpload = createRateLimit({
  windowMs: 60 * 1000,    // 1 menit
  maxRequests: 5,        // max 5 upload per menit
  message: 'Terlalu banyak upload. Coba lagi dalam 1 menit.',
  useEmail: false        // Karena public (tidak perlu login)
});

// Rate limit untuk TTS (PUBLIK - IP saja)
const rateLimitTTS = createRateLimit({
  windowMs: 60 * 1000,    // 1 menit
  maxRequests: 15,       // max 15 TTS request per menit
  message: 'Terlalu banyak permintaan TTS. Coba lagi dalam 1 menit.',
  useEmail: false
});

// Rate limit untuk settings (LOGIN - IP + Email)
const rateLimitSettings = createRateLimit({
  windowMs: 60 * 1000,    // 1 menit
  maxRequests: 20,       // max 10 update per menit
  message: 'Terlalu banyak perubahan settings. Coba lagi dalam 1 menit.',
  useEmail: true
});

// Rate limit untuk proxy (PUBLIK - IP saja)
const rateLimitProxy = createRateLimit({
  windowMs: 60 * 1000,    // 1 menit
  maxRequests: 20,       // max 10 proxy per menit
  message: 'Terlalu banyak proxy request. Coba lagi dalam 1 menit.',
  useEmail: false
});


// ========== ROUTES - LOGIN (ADMIN/STREAMER) ==========
router.get('/settings', authMiddleware, overlayCtrl.getSettings);
router.put('/settings', authMiddleware, rateLimitSettings, overlayCtrl.updateSettings);
router.put('/store/:token', authMiddleware, rateLimitSettings, overlayCtrl.updateStoreProducts);
router.post('/upload-profile-picture', authMiddleware, rateLimitUpload, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Tidak ada file' });
    const imageUrl = req.file.path;
    res.json({ success: true, url: imageUrl });
  } catch (err) {
    res.status(500).json({ message: 'Upload gagal', error: err.message });
  }
});


// ========== ROUTES - PUBLIK (SEMUA ORANG) ==========
router.get('/public/:username', overlayCtrl.getPublicProfile);
router.get('/store/:token', overlayCtrl.getStoreProducts);
router.get('/config/:token', overlayCtrl.getOverlaySettings);
router.get('/tts/voices', ttsCtrl.getVoiceList);

// TTS - PUBLIK + rate limit
router.post('/tts/speak', rateLimitTTS, ttsCtrl.synthesize); 

// Upload - PUBLIK + rate limit
router.post('/upload-voice', rateLimitUpload, upload.single('voice'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = req.file?.path || req.file?.location || req.file?.secure_url;
    res.json({ url });
  } catch (err) {
    console.error('[upload-voice]', err);
    res.status(500).json({ message: 'Upload gagal' });
  }
});

router.post('/upload-audio', rateLimitUpload, upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file audio!' });
    const fileUrl = req.file.path;
    res.json({
      success: true,
      url: fileUrl,
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload gagal: ' + error.message });
  }
});

router.get('/public/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const donors = await Donation.aggregate([
      { $match: { userId: user._id, status: 'PAID' } },
      { $group: {
        _id: '$donorName',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { totalAmount: -1 } },
      { $limit: limit },
      { $project: { _id: 0, donorName: '$_id', totalAmount: 1, count: 1 } }
    ]);

    res.json({ donors });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/leaderboard/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const Donation = require('../models/donation');

    const donors = await Donation.aggregate([
      { $match: { userId: user._id, status: 'PAID' } },
      { $group: {
        _id: '$donorName',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { totalAmount: -1 } },
      { $limit: limit },
      { $project: { _id: 0, donorName: '$_id', totalAmount: 1, count: 1 } }
    ]);

    res.json({ donors });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Proxy - PUBLIK + rate limit
router.get('/proxy-audio', rateLimitProxy, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ message: 'Missing URL' });

    console.log('🔄 Proxying:', url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const mp3Match = html.match(/https:\/\/www\.myinstants\.com\/media\/sounds\/[^'"\s]+\.mp3/);
      if (mp3Match) {
        console.log('🔍 Found MP3:', mp3Match[0]);
        return proxyAudio(mp3Match[0], res);
      }
      throw new Error('No MP3 found in HTML');
    }

    if (contentType.startsWith('audio/')) {
      const buffer = await response.arrayBuffer();
      return sendAudioBuffer(buffer, response.headers, res);
    }

    throw new Error('Not an audio file');
  } catch (err) {
    console.error('❌ Proxy failed:', err.message);
    res.status(400).json({ 
      message: 'Invalid audio URL', 
      error: err.message,
      hint: 'Gunakan direct MP3 link (.mp3, .wav, .ogg)',
    });
  }
});

module.exports = router;