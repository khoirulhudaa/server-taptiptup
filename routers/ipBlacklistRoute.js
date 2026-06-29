// routes/ipBlacklist.js
const express = require('express');
const router = express.Router();
const { IpBlacklist, Donation } = require('../models');
const authMiddleware = require('../middleware/authMiddleware');

// ── GET  /api/ip-blacklist ── Ambil daftar IP yg diblokir milik streamer ──────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const list = await IpBlacklist.find({ userId: req.user.id || req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ blacklist: list });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil blacklist' });
  }
});

// ── POST /api/ip-blacklist ── Tambah IP ke blacklist ─────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { ip, reason, donationId, donorName } = req.body;
 
   console.log('[IP Blacklist] req.user.id:', req.user.id); // ← tambah ini
   console.log('[IP Blacklist] req.user._id:', req.user._id); // ← tambah ini

  if (!ip || !ip.trim()) {
    return res.status(400).json({ message: 'IP address wajib diisi' });
  }

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  const cleanIp = ip.trim();
  if (!ipv4Regex.test(cleanIp) && !ipv6Regex.test(cleanIp)) {
    return res.status(400).json({ message: 'Format IP address tidak valid' });
  }

  try {
    const entry = await IpBlacklist.create({
      userId: req.user.id || req.user._id,
      ip: cleanIp,
      reason: reason?.trim() || '',
      donationId: donationId || null,
      donorName: donorName?.trim() || '',
    });
    res.status(201).json({ message: 'IP berhasil diblokir', entry });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'IP ini sudah ada di blacklist' });
    }
    res.status(500).json({ message: 'Gagal menambahkan IP' });
  }
});

// ── POST /api/ip-blacklist/check ── Cek apakah IP terblokir (public, no auth) ─
router.post('/check', async (req, res) => {
  const { userId, ip } = req.body;
  console.log('[check] body:', { userId, ip });
  
  if (!userId || !ip) return res.json({ blocked: false });
  
  try {
    // Cek raw dulu tanpa filter apapun
    const total = await IpBlacklist.countDocuments();
    const allDocs = await IpBlacklist.find({}).lean();
    console.log('[check] total docs:', total);
    console.log('[check] all docs:', JSON.stringify(allDocs));

    const entry = await IpBlacklist.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      ip: ip.trim() 
    }).lean();
    console.log('[check] findOne result:', entry);
    
    res.json({ blocked: !!entry });
  } catch (err) {
    console.error('[check] ERROR:', err);
    res.json({ blocked: false });
  }
});

// ── GET /api/ip-blacklist/donations-with-ip ──────────────────────────────────
// HARUS di atas /:id agar tidak tertangkap sebagai param
router.get('/donations-with-ip', authMiddleware, async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const donations = await Donation.find({
      userId: req.user.id || req.user._id,
      donorIp: { $ne: null },
      status: 'PAID',
    })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .select('donorName donorIp amount createdAt message _id')
      .lean();

    const blockedIps = await IpBlacklist.find({ userId: req.user.id || req.user._id }).distinct('ip');
    const blockedSet = new Set(blockedIps);

    const result = donations.map(d => ({
      ...d,
      isBlocked: blockedSet.has(d.donorIp),
    }));

    res.json({ donations: result });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil data' });
  }
});

// ── DELETE /api/ip-blacklist/:id ── Hapus IP dari blacklist ──────────────────
// HARUS paling bawah karena /:id akan menangkap semua string
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const entry = await IpBlacklist.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id || req.user._id,
    });
    if (!entry) return res.status(404).json({ message: 'Entry tidak ditemukan' });
    res.json({ message: 'IP berhasil dihapus dari blacklist' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus IP' });
  }
});

module.exports = router;