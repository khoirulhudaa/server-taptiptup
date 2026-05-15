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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper: Kirim Email
const sendEmail = async (to, subject, htmlContent) => {
  await transporter.sendMail({
    from: `"Sistem Admin Sekolah" <${process.env.EMAIL_USER}>`,
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
    const { username, email, password } = req.body;
    console.log('1. Start register:', email);

    // 1. Cek duplikasi
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email sudah digunakan' });
    }

    // 2. Persiapkan PIN
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPin = await bcrypt.hash(pin, 10);
    console.log('2. PIN Generated');

    // 3. Simpan User
    // Catatan: password akan dihash oleh pre-save hook di model User
    const newUser = await User.create({
      username,
      email,
      password,
      overlayToken: crypto.randomBytes(16).toString('hex'),
      verifyPin: hashedPin,
      verifyPinExpired: new Date(Date.now() + 5 * 60 * 1000),
      isVerified: false,
    });
    console.log('3. User created');

    // 4. Buat default setting overlay
    await OverlaySetting.create({
      userId: newUser._id,
      minDonate: 10000,
      overlayTheme: 'modern',
      backgroundColor: '#6366f1',
      textColor: '#ffffff',
      duration: 5000,
    });
    console.log('4. Overlay setting created');

    const verificationPin = Math.floor(100000 + Math.random() * 900000).toString();

    // Kirim PIN ke Email
    const emailTemplate = `
    <div style="background-color: #f4f7f6; padding: 40px 10px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        
        <div style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">Verifikasi Akun</h1>
        </div>

        <div style="padding: 40px 30px; text-align: center;">
          <p style="font-size: 16px; color: #666; margin-bottom: 10px;">Halo, <strong style="color: #1e3c72;">TapTipTup</strong></p>
          <p style="font-size: 15px; color: #888; line-height: 1.6;">Terima kasih telah bergabung. Gunakan kode PIN di bawah ini untuk menyelesaikan pendaftaran akun</p>
          
          <div style="margin: 30px 0; padding: 20px; background-color: #f8fafd; border: 2px dashed #cbd5e0; border-radius: 8px;">
            <span style="font-size: 36px; font-weight: bold; color: #1e3c72; letter-spacing: 10px; font-family: monospace;">${verificationPin}</span>
          </div>

          <p style="font-size: 13px; color: #a0aec0; margin-top: 20px;">*Kode bersifat rahasi. Mohon tidak membagikan kode ini kepada siapa pun!</p>
        </div>

        <div style="background-color: #fcfcfc; padding: 20px; text-align: center; border-top: 1px solid #f0f0f0;">
          <p style="font-size: 12px; color: #999; margin: 0;">© 2026 Sistem Admin Sekolah. All rights reserved.</p>
        </div>
      </div>
    </div>
    `;

    // Kirim Email
    await sendEmail(email, 'Konfirmasi PIN Verifikasi Sekolah', emailTemplate);

    return res.status(201).json({ 
      message: 'Registrasi berhasil! PIN verifikasi telah dikirim ke email kamu.' 
    });

  } catch (err) {
    console.error('GENERAL_REGISTER_ERROR:', err);
    res.status(500).json({ 
      message: 'Terjadi kesalahan sistem saat registrasi.',
      error: err.message 
    });
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
    const { username, email, bio, instagram, facebook, youtube, twitter } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { 
        username, 
        email, 
        bio,
        instagram,
        facebook,
        youtube,
        twitter 
      },
      { new: true, runValidators: true }
    ).select('-password').lean();

    res.json({ 
      message: 'Profil berhasil diupdate', 
      user 
    });
  } catch (err) {
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

// ============================================================
// TAMBAHKAN ke controllers/authController.js
// ============================================================

// ── Import tambahan (pastikan sudah ada di bagian atas file) ─
// const crypto = require('crypto');       ← sudah ada
// const bcrypt = require('bcryptjs');     ← sudah ada
// const { User } = require('../models'); ← sudah ada

// ============================================================
// VERIFY PIN (email verification saat register)
// ============================================================
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
      return res.status(400).json({ message: 'PIN tidak valid' });
    }

    // Tandai verified - FIX: hapus verifyPin dan verifyPinExpired
    user.isVerified = true;
    user.verifyPin = undefined;  // ✅ FIXED
    user.verifyPinExpired = undefined;
    await user.save();

    return res.json({ message: 'Akun berhasil diverifikasi! Silakan login.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
// RESEND PIN (kirim ulang PIN verifikasi)
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
    user.verifyPinExpired = new Date(Date.now() + 5 * 60 * 1000); // 5 menit
    await user.save();

    const emailTemplate = `
    <div style="background-color: #f4f7f6; padding: 40px 10px; font-family: 'Segoe UI', sans-serif; color: #333;">
      <div style="max-width: 500px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); padding: 30px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">Kode PIN Baru</h1>
        </div>
        <div style="padding: 40px 30px; text-align: center;">
          <p style="font-size: 15px; color: #888; line-height: 1.6; margin-bottom: 20px;">
            Berikut PIN verifikasi baru kamu. Berlaku selama <strong>5 menit</strong>.
          </p>
          <div style="margin: 24px 0; padding: 20px; background: #f8fafd; border: 2px dashed #cbd5e0; border-radius: 8px;">
            <span style="font-size: 36px; font-weight: bold; color: #1e3c72; letter-spacing: 10px; font-family: monospace;">${pin}</span>
          </div>
          <p style="font-size: 13px; color: #a0aec0;">Jangan bagikan PIN ini kepada siapapun.</p>
        </div>
      </div>
    </div>`;

    await sendEmail(email, 'PIN Verifikasi Baru - TapTipTup', emailTemplate);

    return res.json({ message: 'PIN baru telah dikirim ke email kamu.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
// FORGOT PASSWORD — kirim link reset ke email
// ============================================================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    // Selalu return sukses agar tidak expose info user terdaftar/tidak
    if (!user) {
      return res.json({ message: 'Jika email terdaftar, link reset akan dikirim.' });
    }

    // Generate token reset (random hex 32 byte)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpired = new Date(Date.now() + 15 * 60 * 1000); // 15 menit
    await user.save();

    // Link reset — sesuaikan FRONTEND_URL di .env
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${email}`;

    await sendResetEmail(email, resetLink);

    return res.json({ message: 'Link reset password telah dikirim ke email kamu. Berlaku 15 menit.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
// RESET PASSWORD — set password baru dengan token
// ============================================================
exports.resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    // Hash token dari request, lalu cocokkan dengan yang tersimpan
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email,
      resetPasswordToken: hashedToken,
      resetPasswordExpired: { $gt: new Date() }, // belum expired
    });

    if (!user) {
      return res.status(400).json({ message: 'Token tidak valid atau sudah kadaluarsa.' });
    }

    // Set password baru (pre-save hook akan hash otomatis)
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpired = undefined;
    await user.save();

    return res.json({ message: 'Password berhasil direset. Silakan login dengan password baru.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};