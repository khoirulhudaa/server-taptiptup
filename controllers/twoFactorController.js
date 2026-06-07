const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { User } = require('../models');

// ====================== ENABLE 2FA ======================
exports.enable2FA = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    const secret = authenticator.generateSecret();

    const otpauth = authenticator.keyuri(
      user.email || user.username,
      'TTT Streamer',        // Nama aplikasi kamu
      secret
    );

    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // Simpan secret ke database
    user.twoFactorSecret = secret;
    user.twoFactorEnabled = true;
    await user.save();

    res.json({
      success: true,
      qrCodeUrl,
      secret,           // Optional: boleh ditampilkan sekali saja
      message: '2FA berhasil diaktifkan. Scan QR Code menggunakan Google Authenticator.'
    });

  } catch (err) {
    console.error('[Enable 2FA]', err);
    res.status(500).json({ message: 'Gagal mengaktifkan 2FA' });
  }
};

// ====================== VERIFY 2FA ======================
exports.verify2FA = async (req, res) => {
  try {
    const { totpCode } = req.body;
    if (!totpCode || totpCode.length !== 6) {
      return res.status(400).json({ message: 'Kode harus 6 digit' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA belum diaktifkan' });
    }

    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret
    });

    if (!isValid) {
      return res.status(401).json({ message: 'Kode Google Authenticator salah' });
    }

    res.json({ 
      success: true, 
      message: 'Verifikasi 2FA berhasil' 
    });

  } catch (err) {
    console.error('[Verify 2FA]', err);
    res.status(500).json({ message: 'Terjadi kesalahan saat verifikasi' });
  }
};

// ====================== CEK STATUS 2FA ======================
exports.get2FAStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      twoFactorEnabled: !!user?.twoFactorEnabled,
      hasSecret: !!user?.twoFactorSecret
    });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengambil status 2FA' });
  }
};