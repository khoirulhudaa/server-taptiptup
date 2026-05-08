// const { User, OverlaySetting } = require('../models');
// const crypto = require('crypto');
// const jwt = require('jsonwebtoken');
// const nodemailer = require('nodemailer');
// const bcrypt = require('bcryptjs');
// const { sendPinEmail } = require('../utils/sendPinEmail');

// const JWT_SECRET = process.env.JWT_SECRET;

// // ============================================================
// // HELPER: Kirim Email Reset Password
// // ============================================================
// const sendResetEmail = async (email, resetLink) => {
//   const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//       user: process.env.EMAIL_USER,
//       pass: process.env.EMAIL_PASS,
//     },
//   });

//   await transporter.sendMail({
//     to: email,
//     subject: 'Reset Password - Dukung.In',
//     html: `
//       <h2>Reset Password</h2>
//       <p>Klik link di bawah untuk reset password kamu:</p>
//       <a href="${resetLink}" style="color:#6366f1;font-weight:bold">${resetLink}</a>
//       <p>Link berlaku selama <strong>15 menit</strong>.</p>
//       <p>Jika kamu tidak merasa melakukan permintaan ini, abaikan email ini.</p>
//     `,
//   });
// };

// // ============================================================
// // REGISTER
// // ============================================================
// exports.register = async (req, res) => {
//   try {
//     const { username, email, password } = req.body;

//     const existingUser = await User.findOne({ where: { email } });
//     if (existingUser) {
//       return res.status(400).json({ message: 'Email sudah digunakan' });
//     }

//     const pin = Math.floor(100000 + Math.random() * 900000).toString();
//     const hashedPin = await bcrypt.hash(pin, 10);

//     const newUser = await User.create({
//       username,
//       email,
//       password,
//       overlayToken: crypto.randomBytes(16).toString('hex'),
//       verifyPin: hashedPin,
//       verifyPinExpired: new Date(Date.now() + 5 * 60 * 1000),
//       isVerified: false,
//     });

//     await OverlaySetting.create({
//       userId: newUser.id,
//       minDonate: 10000,
//       overlayTheme: 'modern',
//       backgroundColor: '#6366f1',
//       textColor: '#ffffff',
//       duration: 5000,
//     });

//     await sendPinEmail(email, pin);

//     res.json({ message: 'PIN verifikasi telah dikirim ke email' });
//   } catch (err) {
//     res.status(500).json({ message: 'Registrasi gagal', error: err.message });
//   }
// };

// // ============================================================
// // LOGIN
// // ============================================================
// exports.login = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     const user = await User.findOne({ where: { email } });
//     if (!user) {
//       return res.status(404).json({ message: 'User tidak ditemukan' });
//     }

//     if (!user.isVerified) {
//       return res.status(403).json({
//         message: 'Akun belum diverifikasi. Cek email Anda.',
//       });
//     }

//     const isPasswordValid = user.validPassword(password);
//     if (!isPasswordValid) {
//       return res.status(401).json({ message: 'Password salah' });
//     }

//     const token = jwt.sign(
//       { id: user.id, username: user.username },
//       JWT_SECRET,
//       { expiresIn: '1d' }
//     );

//     res.json({
//       message: 'Login Berhasil',
//       token,
//       user: {
//         id: user.id,
//         username: user.username,
//         overlayToken: user.overlayToken,
//         balance: user.walletBalance,
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ message: 'Login Gagal', error: err.message });
//   }
// };

// // ============================================================
// // REQUEST RESET PASSWORD
// // ✅ FIX: Tidak ada duplikat, sendResetEmail pakai helper di atas
// // ============================================================
// exports.requestResetPassword = async (req, res) => {
//   try {
//     const { email } = req.body;

//     const user = await User.findOne({ where: { email } });
//     if (!user) {
//       return res.status(404).json({ message: 'Email tidak ditemukan' });
//     }

//     const token = crypto.randomBytes(32).toString('hex');
//     user.resetToken = token;
//     user.resetTokenExpired = new Date(Date.now() + 15 * 60 * 1000);
//     await user.save();

//     const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

//     // ✅ Pakai helper lokal, bukan exports.sendResetEmail yang tidak ada
//     await sendResetEmail(email, resetLink);

//     res.json({ message: 'Link reset password dikirim ke email' });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // ============================================================
// // RESET PASSWORD
// // ============================================================
// exports.resetPassword = async (req, res) => {
//   try {
//     const { token, newPassword } = req.body;

//     const user = await User.findOne({ where: { resetToken: token } });
//     if (!user) {
//       return res.status(400).json({ message: 'Token tidak valid' });
//     }

//     if (new Date() > user.resetTokenExpired) {
//       return res.status(400).json({ message: 'Token expired' });
//     }

//     if (newPassword.length < 6) {
//       return res.status(400).json({ message: 'Password minimal 6 karakter' });
//     }

//     user.password = newPassword;
//     user.resetToken = null;
//     user.resetTokenExpired = null;
//     await user.save();

//     res.json({ message: 'Password berhasil direset' });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // ============================================================
// // VERIFY PIN
// // ============================================================
// exports.verifyPin = async (req, res) => {
//   try {
//     const { email, pin } = req.body;

//     const user = await User.findOne({ where: { email } });
//     if (!user) {
//       return res.status(404).json({ message: 'User tidak ditemukan' });
//     }

//     const isMatch = await bcrypt.compare(pin, user.verifyPin);
//     if (!isMatch) {
//       return res.status(400).json({ message: 'PIN salah' });
//     }

//     if (user.verifyPinExpired < new Date()) {
//       return res.status(400).json({ message: 'PIN expired' });
//     }

//     user.isVerified = true;
//     user.verifyPin = null;
//     user.verifyPinExpired = null;
//     await user.save();

//     res.json({ message: 'Verifikasi berhasil' });
//   } catch (err) {
//     res.status(500).json({ message: 'Gagal verifikasi' });
//   }
// };

// // ============================================================
// // RESEND PIN
// // ============================================================
// exports.resendPin = async (req, res) => {
//   try {
//     const { email } = req.body;

//     const user = await User.findOne({ where: { email } });
//     if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

//     // Anti spam: tunggu minimal 1 menit sejak PIN terakhir dikirim
//     if (
//       user.verifyPinExpired &&
//       user.verifyPinExpired > new Date(Date.now() - 4 * 60 * 1000)
//     ) {
//       return res.status(429).json({ message: 'Tunggu sebelum meminta PIN baru' });
//     }

//     const pin = Math.floor(100000 + Math.random() * 900000).toString();
//     const hashedPin = await bcrypt.hash(pin, 10);

//     user.verifyPin = hashedPin;
//     user.verifyPinExpired = new Date(Date.now() + 5 * 60 * 1000);
//     await user.save();

//     await sendPinEmail(email, pin);

//     res.json({ message: 'PIN dikirim ulang' });
//   } catch (err) {
//     res.status(500).json({ message: 'Gagal resend PIN' });
//   }
// };




// controllers/authController.js
const { User, OverlaySetting } = require('../models');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { sendPinEmail } = require('../utils/sendPinEmail');

const JWT_SECRET = process.env.JWT_SECRET;

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

    // 5. Kirim Email (Titik krusial)
    try {
      await sendPinEmail(email, pin);
      console.log('5. Email sent successfully');
    } catch (mailError) {
      // Jika email gagal, kita hapus user yang tanggung agar bisa daftar ulang
      await User.findByIdAndDelete(newUser._id);
      await OverlaySetting.deleteOne({ userId: newUser._id });
      return res.status(500).json({ 
        message: 'Gagal mengirim email verifikasi. Silakan coba lagi nanti.',
        error: mailError.message 
      });
    }

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

    if (!user.isVerified) {
      return res.status(403).json({
        message: 'Akun belum diverifikasi. Cek email Anda.',
      });
    }

    const isPasswordValid = user.validPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Password salah' });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },  // ← _id
      JWT_SECRET,
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

// ============================================================
// REQUEST RESET PASSWORD
// ============================================================
exports.requestResetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Email tidak ditemukan' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.resetToken = token;
    user.resetTokenExpired = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    await sendResetEmail(email, resetLink);

    res.json({ message: 'Link reset password dikirim ke email' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
// RESET PASSWORD
// ============================================================
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({ resetToken: token });
    if (!user) {
      return res.status(400).json({ message: 'Token tidak valid' });
    }

    if (new Date() > user.resetTokenExpired) {
      return res.status(400).json({ message: 'Token expired' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    }

    // Set password baru — akan di-hash ulang oleh pre('save') hook
    user.password = newPassword;
    user.resetToken = undefined;
    user.resetTokenExpired = undefined;
    await user.save();

    res.json({ message: 'Password berhasil direset' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
// VERIFY PIN
// ============================================================
exports.verifyPin = async (req, res) => {
  try {
    const { email, pin } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    const isMatch = await bcrypt.compare(pin, user.verifyPin);
    if (!isMatch) {
      return res.status(400).json({ message: 'PIN salah' });
    }

    if (user.verifyPinExpired < new Date()) {
      return res.status(400).json({ message: 'PIN expired' });
    }

    user.isVerified = true;
    user.verifyPin = undefined;
    user.verifyPinExpired = undefined;
    await user.save();

    res.json({ message: 'Verifikasi berhasil' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal verifikasi' });
  }
};

// ============================================================
// RESEND PIN
// ============================================================
exports.resendPin = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    // Anti spam: tunggu minimal 1 menit sejak PIN terakhir dikirim
    if (
      user.verifyPinExpired &&
      user.verifyPinExpired > new Date(Date.now() - 4 * 60 * 1000)
    ) {
      return res.status(429).json({ message: 'Tunggu sebelum meminta PIN baru' });
    }

    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPin = await bcrypt.hash(pin, 10);

    user.verifyPin = hashedPin;
    user.verifyPinExpired = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    await sendPinEmail(email, pin);

    res.json({ message: 'PIN dikirim ulang' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal resend PIN' });
  }
};