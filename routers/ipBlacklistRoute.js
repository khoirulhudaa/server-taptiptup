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

  // Validasi format IP sederhana (IPv4 & IPv6)
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

// ── DELETE /api/ip-blacklist/:id ── Hapus IP dari blacklist ──────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const entry = await IpBlacklist.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id || req.user._id, // pastikan hanya bisa hapus milik sendiri
    });
    if (!entry) return res.status(404).json({ message: 'Entry tidak ditemukan' });
    res.json({ message: 'IP berhasil dihapus dari blacklist' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus IP' });
  }
});

// ── GET /api/ip-blacklist/donations-with-ip ── 
// Ambil donasi terbaru beserta donorIp, untuk tampilan "blokir dari riwayat"
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

    // Tandai mana yang sudah diblokir
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

module.exports = router;