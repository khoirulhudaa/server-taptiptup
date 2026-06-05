const express = require('express');
const router = express.Router();
const { Maintenance } = require('../models');
const auth = require('../middleware/authMiddleware');
const superAdminMiddleware = require('../middleware/superAdminMiddleware');

// GET settings - Boleh diakses oleh semua user yang login
router.get('/settings', auth, async (req, res) => {
  try {
    const settings = await Maintenance.findOneAndUpdate(
      {},
      { $setOnInsert: { auth: false, supporter: false, withdrawal: false, dashboard: false } },
      { upsert: true, new: true }
    );

    res.json(settings);
  } catch (err) {
    console.error('[Maintenance GET Error]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// Tambah di routes/maintenance.js — SEBELUM route yang ada
router.get('/public', async (req, res) => {
  try {
    let settings = await Maintenance.findOne();
    if (!settings) return res.json({ auth: false, supporter: false, withdrawal: false, dashboard: false });
    res.json({
      auth: settings.auth,
      supporter: settings.supporter,
      withdrawal: settings.withdrawal,
      dashboard: settings.dashboard,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// UPDATE settings - Hanya Super Admin yang boleh
router.put('/settings', auth, superAdminMiddleware, async (req, res) => {
  try {

    const { auth, supporter, withdrawal, dashboard } = req.body;

    // ✅ upsert=true → buat jika belum ada, update jika sudah ada
    // findOneAndUpdate TIDAK trigger pre('save') hook
    const settings = await Maintenance.findOneAndUpdate(
      {},
      {
        $set: {
          auth: auth ?? false,
          supporter: supporter ?? false,
          withdrawal: withdrawal ?? false,
          dashboard: dashboard ?? false,
          updatedBy: req.user.id,
        }
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Pengaturan berhasil disimpan', data: settings });
  } catch (err) {
    console.error('[Maintenance PUT Error]', err.message); // ← Akan kelihatan errornya
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;