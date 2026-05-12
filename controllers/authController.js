// controllers/authController.js
const { User, OverlaySetting } = require('../models');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { sendPinEmail } = require('../utils/sendPinEmail');
require('dotenv').config();

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