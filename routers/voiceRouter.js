// routers/voiceRouter.js
// Upload voice ke memory (tanpa disk/DB), serve balik untuk overlay

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const voiceStore = require('../utils/voiceStore');

// Multer — simpan ke MEMORY saja, bukan disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // max 10MB
  },
  fileFilter: (req, file, cb) => {
    // Terima semua audio format
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file audio yang diizinkan'), false);
    }
  },
});

// POST /api/voice/upload
// Terima audio dari browser, simpan di RAM, return ID
// Tidak perlu auth — donor guest pun boleh upload
router.post('/upload', upload.single('voice'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Tidak ada file audio' });
    }

    const id = voiceStore.save(req.file.buffer, req.file.mimetype);

    // Return URL yang bisa diakses overlay
    const voiceUrl = `/api/voice/play/${id}`;

    res.json({
      success: true,
      voiceUrl,
      id,
      size: req.file.size,
      mimeType: req.file.mimetype,
      expiresIn: '30 menit',
    });
  } catch (err) {
    console.error('[Voice Upload]', err);
    res.status(500).json({ message: 'Upload gagal', error: err.message });
  }
});

// GET /api/voice/play/:id
// Serve audio langsung dari memory ke browser/overlay
router.get('/play/:id', (req, res) => {
  const entry = voiceStore.get(req.params.id);

  if (!entry) {
    return res.status(404).json({ message: 'Voice message tidak ditemukan atau sudah expired' });
  }

  res.set({
    'Content-Type': entry.mimeType,
    'Content-Length': entry.buffer.length,
    // Jangan cache di browser — ini temporary
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });

  res.send(entry.buffer);
});

// GET /api/voice/status (debug — opsional, bisa dihapus di production)
router.get('/status', (req, res) => {
  res.json({
    stored: voiceStore.size(),
    message: 'Voice messages in memory',
  });
});

module.exports = router;