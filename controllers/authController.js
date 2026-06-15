// controllers/authController.js
const { User, OverlaySetting } = require('../models');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { sendPinEmail } = require('../utils/sendPinEmail');
require('dotenv').config();

// Nodemailer Config
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App Password BUKAN password biasa!
  },
  pool: true, // ✅ FIX: Connection pooling
  maxConnections: 1, // ✅ FIX: Railway limit
  maxMessages: 5, // ✅ FIX: Rate limit
  rateDelta: 3600000, // 1 jam
  rateLimit: 10,
});

// Helper: Kirim Email
const sendEmail = async (to, subject, htmlContent) => {
  await transporter.sendMail({
    from: `"TapTipTup" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html: htmlContent,
  });
};

// ============================================================
// HELPER: Kirim Email Reset Password
// ============================================================
const sendResetEmail = async (email, resetLink) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    to: email,
    subject: 'Reset Password - Dukung.In',
    html: `
      <h2>Reset Password</h2>
      <p>Klik link di bawah untuk reset password kamu:</p>
      <a href="${resetLink}" style="color:#6366f1;font-weight:bold">${resetLink}</a>
      <p>Link berlaku selama <strong>15 menit</strong>.</p>
      <p>Jika kamu tidak merasa melakukan permintaan ini, abaikan email ini.</p>
    `,
  });
};

// ============================================================
// REGISTER
// ============================================================
exports.register = async (req, res) => {
  try {
    const { username, email, password, securityPin } = req.body;

    if (!securityPin || securityPin.length !== 4 || !/^\d{4}$/.test(securityPin)) {
      return res.status(400).json({ message: 'PIN harus 4 digit angka' });
    }

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ 
        message: existing.email === email ? 'Email sudah digunakan' : 'Username sudah digunakan' 
      });
    }

    const newUser = await User.create({
      username,
      email,
      password,
      securityPin,           // akan di-hash otomatis
      overlayToken: crypto.randomBytes(24).toString('hex'),
      isVerified: false,
    });

    // Buat default overlay setting...
      await OverlaySetting.create({
        userId: newUser._id,
        minDonate: 10000,
        overlayTheme: 'modern',
        backgroundColor: '#6366f1',
        textColor: '#ffffff',
        duration: 5000,
      });

    res.status(201).json({ message: 'Registrasi berhasil!' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================================
// LOGIN
// ============================================================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const isPasswordValid = user.validPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Password salah' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email, role: user.role }, // ← tambah role
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login Berhasil',
      token,
      user: {
        id: user._id,
        username: user.username,
        overlayToken: user.overlayToken,
        balance: user.walletBalance,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Login Gagal', error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    .select('-password')
    .lean();
    res.json({ user, User: user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowedFields = [
      'username',
      'email',
      'bio',
      'donateIntro',      // ← Field yang kita butuhkan
      'instagram',
      'facebook',
      'youtube',
      'twitter',
      'profilePicture'
    ];

    const updateData = {};

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // Tambahan validasi username (optional)
    if (updateData.username) {
      const existing = await User.findOne({ 
        username: updateData.username, 
        _id: { $ne: req.user.id } 
      });
      if (existing) {
        return res.status(400).json({ message: 'Username sudah digunakan' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password').lean();

    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({ 
      message: 'Profil berhasil diupdate', 
      user 
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    res.status(400).json({ message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user.validPassword(oldPassword)) {
      return res.status(401).json({ message: 'Password lama salah' });
    }
    user.password = newPassword;
    await user.save(); // pre-save hook akan hash otomatis
    res.json({ message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.verifyPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'Akun sudah terverifikasi' });
    }

    // Cek expired
    if (!user.verifyPinExpired || new Date() > user.verifyPinExpired) {
      return res.status(400).json({ message: 'PIN sudah kadaluarsa. Minta PIN baru.' });
    }

    // Cek PIN
    const isMatch = await bcrypt.compare(pin, user.verifyPin);
    if (!isMatch) {
      return res.status(400).json({ message: 'PIN salah' });
    }

    // ✅ FIXED: Clear PIN fields
    user.isVerified = true;
    user.verifyPin = undefined;      // ✅ CORRECT
    user.verifyPinExpired = undefined;
    await user.save();

    res.json({ 
      message: 'Akun berhasil diverifikasi! Silakan login.' 
    });
  } catch (err) {
    console.error('VERIFY_PIN_ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================================
// RESEND PIN - FIXED
// ============================================================
exports.resendPin = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email tidak terdaftar' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'Akun sudah terverifikasi' });
    }

    // Generate PIN baru
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPin = await bcrypt.hash(pin, 10);

    user.verifyPin = hashedPin;
    user.verifyPinExpired = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // Email template sama seperti register
    const emailTemplate = `...`; // Gunakan template sama seperti register

    await sendEmail(email, '🔄 PIN Verifikasi Baru - TapTipTup', emailTemplate);

    res.json({ message: 'PIN baru berhasil dikirim ke email kamu (5 menit).' });
  } catch (err) {
    console.error('RESEND_PIN_ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ============================================================
// FORGOT PASSWORD - IMPROVED
// ============================================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'Email tidak terdaftar' });
    }

    res.json({ 
      message: 'Silakan masukkan PIN keamanan 4 digit Anda',
      email 
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};
// controllers/authController.js
exports.verifySecurityPin = async (req, res) => {
  try {
    const { email, securityPin } = req.body;

    if (!email || !securityPin || securityPin.length !== 4) {
      return res.status(400).json({ 
        message: 'Email dan PIN 4 digit wajib diisi' 
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email tidak terdaftar' });
    }

    if (!user.securityPin) {
      return res.status(400).json({ 
        message: 'Akun ini belum memiliki PIN keamanan' 
      });
    }

    // === PAKAI BCRYPT LANGSUNG ===
    const isValid = await bcrypt.compare(securityPin, user.securityPin);

    if (!isValid) {
      return res.status(400).json({ message: 'PIN salah' });
    }

    // Generate temporary token
    const tempResetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(tempResetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpired = new Date(Date.now() + 15 * 60 * 1000); // 15 menit
    await user.save();

    res.json({
      success: true,
      message: 'PIN benar',
      tempToken: tempResetToken,
      email: user.email
    });

  } catch (err) {
    console.error('VERIFY_SECURITY_PIN_ERROR:', err);
    res.status(500).json({ 
      message: 'Terjadi kesalahan server. Silakan coba lagi.' 
    });
  }
};

// ============================================================
// RESET PASSWORD - FIXED
// ============================================================
exports.resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email,
      resetPasswordToken: hashedToken,
      resetPasswordExpired: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Token tidak valid atau kadaluarsa' });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpired = undefined;
    await user.save();

    res.json({ message: 'Password berhasil direset' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.changePin = async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;

    if (!currentPin || !newPin || !/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ message: 'PIN harus 4 digit angka' });
    }
    if (currentPin === newPin) {
      return res.status(400).json({ message: 'PIN baru tidak boleh sama dengan PIN lama' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    const isValid = await bcrypt.compare(currentPin, user.securityPin);
    if (!isValid) return res.status(400).json({ message: 'PIN saat ini salah' });

    user.securityPin = newPin; // pre-save hook akan hash otomatis
    await user.save();

    res.json({ message: 'PIN berhasil diubah' });
  } catch (err) {
    console.error('changePin error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};