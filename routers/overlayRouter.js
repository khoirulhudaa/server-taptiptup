// routers/overlayRouter.js — tidak ada perubahan dari versi MySQL
const express = require('express');
const router = express.Router();
const overlayCtrl = require('../controllers/overlayController');
const authMiddleware = require('../middleware/authMiddleware');
const { audioUpload } = require('../middleware/multerConfig');
const { proxyAudio } = require('../utils/proxyAudio');
const upload = require('../middleware/audioUpload');

router.get('/settings',         authMiddleware, overlayCtrl.getSettings);      // ← bukan getOverlaySettings
router.put('/settings',         authMiddleware, overlayCtrl.updateSettings);   // ← ganti POST ke PUT
router.get('/public/:username', overlayCtrl.getPublicProfile);
router.get('/config/:token',    overlayCtrl.getOverlaySettings);
router.post('/upload-voice', upload.single('voice'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = req.file?.path || req.file?.location || req.file?.secure_url;
    res.json({ url });
  } catch (err) {
    console.error('[upload-voice]', err);
    res.status(500).json({ message: 'Upload gagal' });
  }
});

router.post('/upload-audio', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file audio!' });

    // Cloudinary langsung kasih URL permanen di req.file.path
    const fileUrl = req.file.path;

    res.json({
      success: true,
      url: fileUrl,  // https://res.cloudinary.com/...
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload gagal: ' + error.message });
  }
});

router.post('/upload-profile-picture', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Tidak ada file' });

    const imageUrl = req.file.path; // URL Cloudinary langsung

    res.json({ success: true, url: imageUrl });
  } catch (err) {
    res.status(500).json({ message: 'Upload gagal', error: err.message });
  }
});

// ✅ Proxy audio (bypass CORS)
router.get('/proxy-audio', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ message: 'Missing URL' });

    console.log('🔄 Proxying:', url);

    // ✅ FOLLOW REDIRECTS & EXTRACT AUDIO
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    
    // ✅ JIKA HTML (MyInstants page) → cari MP3 link
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const mp3Match = html.match(/https:\/\/www\.myinstants\.com\/media\/sounds\/[^'"\s]+\.mp3/);
      if (mp3Match) {
        console.log('🔍 Found MP3:', mp3Match[0]);
        return proxyAudio(mp3Match[0], res);
      }
      throw new Error('No MP3 found in HTML');
    }

    // ✅ AUDIO DIRECT
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