// controllers/transferController.js
const { User, Follow } = require('../models');
const mongoose = require('mongoose');

// ── GET: Daftar streamer yang mutual follow ───────────────────────────────────
exports.getMutualFollows = async (req, res) => {
  try {
    const myId = req.user.id;

    // Ambil siapa yang saya follow dan siapa yang follow saya
    const [iFollow, theyFollow] = await Promise.all([
      Follow.find({ follower: myId }).select('following').lean(),
      Follow.find({ following: myId }).select('follower').lean(),
    ]);

    const iFollowSet    = new Set(iFollow.map(f => f.following.toString()));
    const theyFollowSet = new Set(theyFollow.map(f => f.follower.toString()));

    // Mutual = irisan keduanya
    const mutualIds = [...iFollowSet].filter(id => theyFollowSet.has(id));

    if (mutualIds.length === 0) {
      return res.json({ users: [] });
    }

    const users = await User.find({
      _id: { $in: mutualIds.map(id => new mongoose.Types.ObjectId(id)) },
    })
      .select('username profilePicture')
      .lean();

    res.json({ users });
  } catch (err) {
    console.error('[Transfer] getMutualFollows error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ── POST: Kirim saldo ke streamer lain ───────────────────────────────────────
exports.transferBalance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const senderId      = req.user.id;
    const { recipientId, amount, note } = req.body;

    // ── Validasi input ────────────────────────────────────────────────────────
    if (!recipientId || !amount) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'recipientId dan amount wajib diisi' });
    }

    const numAmount = Number(amount);

    if (!Number.isInteger(numAmount) || numAmount < 1000 || numAmount > 1_000_000) {
      await session.abortTransaction();
      return res.status(400).json({
        message: 'Jumlah transfer harus antara Rp 1.000 – Rp 1.000.000',
      });
    }

    if (senderId === recipientId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Tidak bisa transfer ke diri sendiri' });
    }

    // ── Cek mutual follow ─────────────────────────────────────────────────────
    const [iFollow, theyFollow] = await Promise.all([
      Follow.exists({ follower: senderId,    following: recipientId }),
      Follow.exists({ follower: recipientId, following: senderId    }),
    ]);

    if (!iFollow || !theyFollow) {
      await session.abortTransaction();
      return res.status(403).json({
        message: 'Hanya bisa transfer ke streamer yang saling follow',
      });
    }

    // ── Ambil data sender ─────────────────────────────────────────────────────
    const sender = await User.findById(senderId).session(session);
    if (!sender) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Akun tidak ditemukan' });
    }

    if ((sender.availableBalance ?? 0) < numAmount) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Saldo tidak cukup' });
    }

    // ── Ambil data recipient ──────────────────────────────────────────────────
    const recipient = await User.findById(recipientId).session(session);
    if (!recipient) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Penerima tidak ditemukan' });
    }

    // ── Transaksi saldo ───────────────────────────────────────────────────────
    sender.availableBalance    = (sender.availableBalance    ?? 0) - numAmount;
    sender.walletBalance       = (sender.walletBalance       ?? 0) - numAmount;
    recipient.availableBalance = (recipient.availableBalance ?? 0) + numAmount;
    recipient.walletBalance    = (recipient.walletBalance    ?? 0) + numAmount;

    await sender.save({ session });
    await recipient.save({ session });

    await session.commitTransaction();

    res.json({
      message: `Berhasil mengirim Rp ${numAmount.toLocaleString('id-ID')} ke @${recipient.username}`,
      newBalance: sender.availableBalance,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('[Transfer] transferBalance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    session.endSession();
  }
};