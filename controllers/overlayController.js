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
        role: user.role,
        roleUpgradeNotified: user.roleUpgradeNotified,
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
    const userId = req.user.id;
    const slot = (req.query.slot || 'A').toUpperCase();

    const allowedFields = [
      'minDonate', 'maxDonate', 'overlayEnabled', 'customIcon', 'showTimestamp',
      'theme', 'primaryColor', 'textColor', 'borderColor', 'animation', 'maxWidth', 
      'overlayPosition', 'activeSlot',

      // Field Durasi
      'baseDuration', 'extraPerAmount', 'extraDuration', 'durationTiers',
      'alertBaseDuration', 'alertExtraPerAmount', 'alertExtraDuration',
      'mediaShareBaseDuration', 'mediaShareExtraPerAmount', 'mediaShareExtraDuration',
      'voiceBaseDuration', 'voiceExtraPerAmount', 'voiceExtraDuration',

      // Field lainnya
      'mediaTriggers', 'soundUrl', 'customCss', 'highlightColor',
      'soundTiers', 'leaderboardShowAmount', 'quickAmounts', 'leaderboardLimit', 
      'leaderboardPeriod', 'publicSounds', 'publicSoundDefault',
      'ttsEnabled', 'ttsRate', 'ttsPitch', 'ttsVolume', 'ttsVoiceName', 'ttsLanguageCode',  
      'feeBearer'
    ];

    const updateData = {};
    allowedFields.forEach(key => {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    // Update settings di slot yang sedang diedit
    const setting = await OverlaySetting.findOneAndUpdate(
      { userId, slot },
      { $set: updateData },
      { 
        new: true, 
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true 
      }
    );

    // ==================== KRITIS: Handle activeSlot ====================
    if (updateData.activeSlot) {
      await OverlaySetting.findOneAndUpdate(
        { userId, slot: 'A' },
        { 
          $set: { 
            activeSlot: updateData.activeSlot,
            updatedAt: new Date()
          } 
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    // ==================== EMIT SOCKET (PENTING!) ====================
    const io = req.app.get('io');           // Ambil instance socket.io
    if (io) {
      // Cari overlayToken user untuk emit ke room yang benar
      const user = await User.findById(userId).select('overlayToken').lean();
      
      if (user?.overlayToken) {
        io.to(user.overlayToken).emit('settings-updated');
        console.log(`[Socket] 'settings-updated' dikirim ke room: ${user.overlayToken} | activeSlot → ${updateData.activeSlot || 'A'}`);
      } else {
        console.warn('[Socket] overlayToken tidak ditemukan untuk user ini');
      }
    } else {
      console.warn('[Socket] io instance tidak tersedia');
    }

    res.json({ 
      message: 'Settings updated!', 
      data: setting,
      activeSlot: updateData.activeSlot || setting.activeSlot
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
      'username _id bio donateIntro profilePicture instagram facebook youtube twitter followersCount followingCount'
    ).lean();

    if (!user) return res.status(404).json({ message: 'Streamer tidak ditemukan' });

    const slot = (req.query.slot || 'A').toUpperCase();   // ← TAMBAHKAN INI

    const overlaySetting = await OverlaySetting.findOne({ 
      userId: user._id, 
      slot 
    }).lean();

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
    const user = await User.findOne({ overlayToken: req.params.token });
    if (!user) return res.status(404).json({ message: 'Token tidak valid' });

    const slot = (req.query.slot || 'A').toUpperCase();

    const setting = await OverlaySetting.findOne({ 
      userId: user._id, 
      slot 
    }).lean();

    const data = setting || {};
    
    if (slot === 'A') {
      data.activeSlot = data.activeSlot || 'A';
    }

    res.json(data);
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