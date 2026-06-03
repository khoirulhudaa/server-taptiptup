// controllers/overlayController.js
const { OverlaySetting, User } = require('../models');
require('dotenv').config();

// ============================================================
// GET SETTINGS (user yang sedang login)
// ============================================================
exports.getSettings = async (req, res) => {
  try {
    const userId = req.user.id;

    const slot = (req.query.slot || 'A').toUpperCase();
    const overlaySetting = await OverlaySetting.findOne({ userId, slot }).lean();
 
    const user = await User.findById(userId)
      .select('-password')
      .lean();
 
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
 
    // const overlaySetting = await OverlaySetting.findOne({ userId }).lean();
 
    // ── Hitung saldo ──────────────────────────────────────────
    const walletBalance    = parseFloat(user.walletBalance    || 0);
    const availableBalance = parseFloat(user.availableBalance || 0);
    // pendingBalance = total donasi yang belum genap 1 hari
    const pendingBalance   = Math.max(0, walletBalance - availableBalance);
 
    res.json({
      // Expose di level atas agar mudah diakses frontend
      walletBalance,
      availableBalance,
      pendingBalance,
 
      // Tetap kirim User object untuk kompatibilitas
      User: {
        ...user,
        walletBalance,
        availableBalance,
        pendingBalance,
      },
 
      settings: overlaySetting || {},
      overlaySetting: overlaySetting || {},
    });
  } catch (err) {
    console.error('[getSettings] Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const allowedFields = [
      'minDonate', 'maxDonate', 'overlayEnabled', 'customIcon', 'showTimestamp',
      'theme', 'primaryColor', 'textColor', 'borderColor', 'animation', 'maxWidth', 
      'overlayPosition', 'minDonate', 'maxDonate',

      // Field Durasi Lama
      'baseDuration', 'extraPerAmount', 'extraDuration', 'durationTiers',

      // ✅ FIELD DURASI BARU — WAJIB DITAMBAHKAN
      'alertBaseDuration',
      'alertExtraPerAmount',
      'alertExtraDuration',
      'mediaShareBaseDuration',
      'mediaShareExtraPerAmount',
      'mediaShareExtraDuration',
      'voiceBaseDuration',
      'voiceExtraPerAmount',
      'voiceExtraDuration',

      // Field lainnya
      'mediaTriggers', 'soundUrl', 'customCss', 'highlightColor',
      'soundTiers', 'leaderboardShowAmount', 'quickAmounts', 'leaderboardLimit', 
      'leaderboardPeriod', 'publicSounds', 'publicSoundDefault',
      'ttsEnabled', 'ttsRate', 'ttsPitch', 'ttsVolume', 'ttsVoiceName', 'ttsLanguageCode',  
      'feeBearer'
    ];

    const slot = (req.query.slot || 'A').toUpperCase();

    const updateData = {};
    allowedFields.forEach(key => {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    // const setting = await OverlaySetting.findOneAndUpdate(
    //   { userId: req.user.id },
    //   { $set: updateData },
    //   { new: true, upsert: true, runValidators: true }
    // );

    const setting = await OverlaySetting.findOneAndUpdate(
      { userId: req.user.id, slot },           // query
      { $set: updateData },
      { 
        new: true, 
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true   // ← tambahkan ini
      }
    );

    res.json({ 
      message: 'Settings updated!', 
      data: setting 
    });

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
      'username _id bio donateIntro profilePicture instagram facebook youtube twitter followersCount followingCount' // ← TAMBAHKAN INI
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
      donateIntro: user.donateIntro || 'Support aku biar makin semangat 🚀',
      profilePicture: user.profilePicture || '',   // ← TAMBAHKAN
      twitter: user.twitter || '',
      followersCount: user.followersCount || 0,
      followingCount: user.followingCount || 0,
      overlaySetting,
      feeBearer: overlaySetting?.feeBearer || 'streamer',
      OverlaySetting: overlaySetting, // untuk kompatibilitas lama
      publicSounds: overlaySetting?.publicSounds || [],
      alertBaseDuration: overlaySetting?.alertBaseDuration,
      alertExtraPerAmount: overlaySetting?.alertExtraPerAmount,
      alertExtraDuration: overlaySetting?.alertExtraDuration,
      mediaShareBaseDuration: overlaySetting?.mediaShareBaseDuration,
      mediaShareExtraPerAmount: overlaySetting?.mediaShareExtraPerAmount,
      mediaShareExtraDuration: overlaySetting?.mediaShareExtraDuration,
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

// ====================== GET STORE PRODUCTS (untuk Widget OBS) ======================
exports.getStoreProducts = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ message: 'Token diperlukan' });
    }

    // Cari user berdasarkan overlayToken
    const user = await User.findOne({ overlayToken: token }).lean();

    if (!user) {
      return res.status(404).json({ message: 'Token tidak valid' });
    }

    // Ambil setting store milik user tersebut
    const overlaySetting = await OverlaySetting.findOne({ 
      userId: user._id 
    }).select('storeProducts').lean();

    res.json({
      products: overlaySetting?.storeProducts || []
    });

  } catch (err) {
    console.error('[getStoreProducts] Error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ====================== UPDATE STORE PRODUCTS ======================
exports.updateStoreProducts = async (req, res) => {
  try {
    const { products } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ message: 'Products harus berupa array' });
    }

    const setting = await OverlaySetting.findOneAndUpdate(
      { userId: req.user.id },
      { 
        $set: { 
          storeProducts: products 
        } 
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({ 
      success: true, 
      message: 'Toko berhasil diperbarui',
      products: setting.storeProducts 
    });

  } catch (err) {
    console.error('[updateStoreProducts] Error:', err);
    res.status(500).json({ message: 'Gagal menyimpan toko', error: err.message });
  }
};