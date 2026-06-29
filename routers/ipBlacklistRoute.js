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
// HARUS di atas /:id agar tidak tertangkap sebagai param
router.post('/check', async (req, res) => {
  const { userId, ip } = req.body;
  console.log('[IP Check] Request:', { userId, ip });
  
  if (!userId || !ip) return res.json({ blocked: false });
  
  try {
    // Cek semua data di collection dulu
    const allEntries = await IpBlacklist.find({ ip: ip.trim() }).lean();
    console.log('[IP Check] Semua entry dengan IP ini:', allEntries);

    const entry = await IpBlacklist.findOne({ 
      userId: new mongoose.Types.ObjectId(userId), 
      ip: ip.trim() 
    }).lean();
    console.log('[IP Check] Result findOne:', entry);
    
    res.json({ blocked: !!entry });
  } catch (err) {
    console.error('[IP Check Error]', err.message);
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