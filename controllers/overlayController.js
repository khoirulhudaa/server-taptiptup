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

exports.updateSettings = async (req, res) => {
  try {
    const allowedFields = [
      'minDonate', 'maxDonate', 'overlayEnabled', 'customIcon', 'showTimestamp',
      'theme', 'primaryColor', 'textColor', 'borderColor', 'animation', 'maxWidth', 
      'overlayPosition', 'baseDuration', 'extraPerAmount', 'extraDuration',
      'durationTiers', 'mediaTriggers', 'soundUrl', 'customCss', 'highlightColor',
      'soundTiers', 'leaderboardShowAmount', 'quickAmounts', 'leaderboardLimit', 
      'leaderboardPeriod', 'publicSounds', 'publicSoundDefault'
    ];

    console.log('[updateSettings] body:', JSON.stringify(req.body, null, 2));

    // ✅ FIXED SYNTAX ERROR
    const updateData = {};
    allowedFields.forEach(key => {
      if (req.body[key] !== undefined) {  // ← FIXED: !== undefined
        updateData[key] = req.body[key];
      }
    });

    const setting = await OverlaySetting.findOneAndUpdate(
      { userId: req.user.id },
      { $set: updateData },
      { new: true, upsert: true, runValidators: false }
    );

    // Emit ke OBS
    try {
      const io = req.app.get('socketio');
      const user = await User.findById(req.user.id).lean();
      if (io && user?.overlayToken) {
        io.to(user.overlayToken).emit('settings-updated', setting);
      }
    } catch (e) {}

    res.json({ message: 'Settings updated!', data: setting });
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
      'username _id bio instagram facebook youtube twitter followersCount followingCount' // ← TAMBAHKAN INI
    ).lean();

    if (!user) return res.status(404).json({ message: 'Streamer tidak ditemukan' });

    const overlaySetting = await OverlaySetting.findOne({ userId: user._id }).lean();

    res.json({
      ...user,
      // Pastikan social media ikut terkirim
      bio: user.bio || '',
      instagram: user.instagram || '',
      facebook: user.facebook || '',
      youtube: user.youtube || '',
      twitter: user.twitter || '',
      followersCount: user.followersCount || 0,
      followingCount: user.followingCount || 0,
      overlaySetting,
      OverlaySetting: overlaySetting, // untuk kompatibilitas lama
      publicSounds: overlaySetting?.publicSounds || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
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

exports.uploadPublicSound = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Tidak ada file audio' });
    }

    const audioUrl = `${process.env.BASE_URL}/uploads/audio/${req.file.filename}`;
    
    res.json({
      message: 'Audio uploaded successfully',
      url: audioUrl,
      filename: req.file.filename
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
