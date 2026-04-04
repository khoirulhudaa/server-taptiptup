const { User, OverlaySetting } = require('../models');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { sendPinEmail } = require('../utils/sendPinEmail');

// Gunakan Secret Key dari .env atau string rahasia
const JWT_SECRET = process.env.JWT_SECRET;

// =============================
// 🔑 RESET PASSWORD EMAIL
// =============================
exports.requestResetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "Email tidak ditemukan" });
    }

    const token = crypto.randomBytes(32).toString('hex');

    user.resetToken = token;
    user.resetTokenExpired = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    // ✅ pakai function reusable
    await exports.sendResetEmail(email, resetLink);

    res.json({ message: "Link reset password dikirim ke email" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// --- REGISTER ---
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "Email sudah digunakan" });
    }

    const pin = Math.floor(100000 + Math.random() * 900000).toString();

    // 🔐 HASH PIN
    const hashedPin = await bcrypt.hash(pin, 10);

    const newUser = await User.create({
      username,
      email,
      password,
      overlayToken: crypto.randomBytes(16).toString('hex'),
      verifyPin: hashedPin,
      verifyPinExpired: new Date(Date.now() + 5 * 60 * 1000),
      isVerified: false
    });

    await OverlaySetting.create({ 
      userId: newUser.id,
      minDonate: 10000,
      overlayTheme: 'modern',
      backgroundColor: '#6366f1',
      textColor: '#ffffff',
      duration: 5000
    });

    await sendPinEmail(email, pin);

    res.json({
      message: "PIN verifikasi telah dikirim ke email"
    });

  } catch (err) {
    res.status(500).json({ message: "Registrasi gagal", error: err.message });
  }
};

// --- LOGIN ---
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Cari user berdasarkan email
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan" });
        }

        if (!user.isVerified) {
            return res.status(403).json({
                message: "Akun belum diverifikasi. Cek email Anda."
            });
        }

        // 2. Validasi Password (menggunakan method validPassword di model User Anda)
        const isPasswordValid = user.validPassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Password salah" });
        }

        // 3. Buat Token JWT
        const token = jwt.sign(
            { id: user.id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '1d' } // Token berlaku 1 hari
        );

        // 4. Kirim response ke Client
        res.json({
            message: "Login Berhasil",
            token: token,
            user: {
                id: user.id,
                username: user.username,
                overlayToken: user.overlayToken,
                balance: user.walletBalance
            }
        });
    } catch (err) {
        res.status(500).json({ message: "Login Gagal", error: err.message });
    }
};

exports.requestResetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "Email tidak ditemukan" });
    }

    const token = crypto.randomBytes(32).toString('hex');

    user.resetToken = token;
    user.resetTokenExpired = new Date(Date.now() + 15 * 60 * 1000); // 15 menit
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      to: email,
      subject: "Reset Password",
      html: `
        <h2>Reset Password</h2>
        <p>Klik link di bawah untuk reset password:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>Berlaku 15 menit</p>
      `
    });

    res.json({ message: "Link reset password dikirim ke email" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({
      where: { resetToken: token }
    });

    if (!user) {
      return res.status(400).json({ message: "Token tidak valid" });
    }

    if (new Date() > user.resetTokenExpired) {
      return res.status(400).json({ message: "Token expired" });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password minimal 6 karakter" });
    }

    user.password = newPassword;
    user.resetToken = null;
    user.resetTokenExpired = null;

    await user.save();

    res.json({ message: "Password berhasil direset" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.verifyPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const isMatch = await bcrypt.compare(pin, user.verifyPin);
    if (!isMatch) {
      return res.status(400).json({ message: "PIN salah" });
    }

    if (user.verifyPinExpired < new Date()) {
      return res.status(400).json({ message: "PIN expired" });
    }

    user.isVerified = true;
    user.verifyPin = null;
    user.verifyPinExpired = null;

    await user.save();

    res.json({ message: "Verifikasi berhasil" });

  } catch (err) {
    res.status(500).json({ message: "Gagal verifikasi" });
  }
};

exports.resendPin = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ where: { email } });

    if (!user) return res.status(404).json({ message: "User tidak ditemukan" });

    // ⛔ anti spam (1 menit)
    if (user.verifyPinExpired && user.verifyPinExpired > new Date(Date.now() - 4 * 60 * 1000)) {
      return res.status(429).json({ message: "Tunggu sebelum meminta PIN baru" });
    }

    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPin = await bcrypt.hash(pin, 10);

    user.verifyPin = hashedPin;
    user.verifyPinExpired = new Date(Date.now() + 5 * 60 * 1000);

    await user.save();

    await sendPinEmail(email, pin);

    res.json({ message: "PIN dikirim ulang" });

  } catch (err) {
    res.status(500).json({ message: "Gagal resend PIN" });
  }
};