// routers/transferRouter.js
const express      = require('express');
const router       = express.Router();
const transferCtrl = require('../controllers/transferController');
const auth         = require('../middleware/authMiddleware');
const { createRateLimit } = require('../middleware/rateLimit');

const transferRateLimit = createRateLimit({
  windowMs: 60 * 1000,   // 1 menit
  maxRequests: 10,
  message: 'Terlalu banyak percobaan transfer. Coba lagi dalam 1 menit.',
});

// GET /api/transfer/mutual-follows   — daftar streamer mutual follow
router.get('/mutual-follows', auth, transferCtrl.getMutualFollows);

// POST /api/transfer                 — kirim saldo
router.post('/', auth, transferRateLimit, transferCtrl.transferBalance);

module.exports = router;