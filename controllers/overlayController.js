// controllers/overlayController.js
const { OverlaySetting, User } = require('../models');
require('dotenv').config();

// ============================================================
// GET SETTINGS (user yang sedang login)
// ============================================================
exports.getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .lean();

    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    const overlaySetting = await OverlaySetting.findOne({ userId: user._id }).lean();

    res.json({
      user,
      User: user,
      overlaySetting,
      settings: overlaySetting,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

// ============================================================
// UPDATE SETTINGS (upsert)
// ============================================================
exports.updateSettings = async (req, res) => {
  try {
    const allowedFields = [
      'minDonate', 'maxDonate',
      'overlayEnabled',   // ← NEW: toggle on/off overlay
      'customIcon',       // ← NEW: custom icon emoji atau URL
      'showTimestamp',    // ← NEW: tampilkan timestamp di overlay
      'theme', 'primaryColor', 'textColor',
      'animation', 'maxWidth', 'overlayPosition',
      'baseDuration', 'extraPerAmount', 'extraDuration',
      'durationTiers', 'mediaTriggers',
      'soundUrl', 'customCss',
    ];

    console.log('[updateSettings] body:', JSON.stringify(req.body, null, 2));

    const updateData = {};
    allowedFields.forEach(key => {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    });

    const setting = await OverlaySetting.findOneAndUpdate(
      { userId: req.user.id },
      { $set: updateData },
      { new: true, upsert: true, runValidators: false }
    );

    try {
      const io = req.app.get('socketio');
      const user = await User.findById(req.user.id).lean();
      if (io && user?.overlayToken) {
        io.to(user.overlayToken).emit('settings-updated', setting);
      }
    } catch (e) {}

    res.json({ message: 'Settings updated successfully', data: setting });
  } catch (err) {
    console.error('[updateSettings] Error:', err);
    res.status(400).json({ message: 'Update failed', error: err.message });
  }
};

// ============================================================
// GET PUBLIC PROFILE — untuk halaman donasi (berdasarkan username)
// ============================================================
exports.getPublicProfile = async (req, res) => {
  try {
    const user = await User.findOne(
      { username: req.params.username },
      'username _id'
    ).lean();

    if (!user) return res.status(404).json({ message: 'Streamer tidak ditemukan' });

    const overlaySetting = await OverlaySetting.findOne({ userId: user._id }).lean();

    res.json({
      ...user,
      overlaySetting,
      OverlaySetting: overlaySetting,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// GET OVERLAY SETTINGS — untuk OBS (berdasarkan overlayToken)
// ============================================================
exports.getOverlaySettings = async (req, res) => {
  try {
    const user = await User.findOne({ overlayToken: req.params.token }).lean();

    if (!user) return res.status(404).json({ message: 'Token tidak valid' });

    const overlaySetting = await OverlaySetting.findOne({ userId: user._id }).lean();
    res.json(overlaySetting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};