// controllers/midtransController.js
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Donation, Withdrawal, User, OverlaySetting } = require('../models');
const { filterMessage } = require('./bannedWordController');
const subathonCtrl = require('./subathonController');
const { donationQueue } = require('../utils/donationQueue');
require('dotenv').config();

// ============================================================
// DETEKSI ENVIRONMENT
// ============================================================
const isProduction = process.env.NODE_ENV === 'production';

const SERVER_KEY = isProduction
  ? process.env.MIDTRANS_SERVER_KEY
  : process.env.DEV_MIDTRANS_SERVER_KEY;

const CLIENT_KEY = isProduction
  ? process.env.MIDTRANS_CLIENT_KEY
  : process.env.DEV_MIDTRANS_CLIENT_KEY;

const BASE_URL = isProduction
  ? process.env.FRONTEND_URL
  : process.env.DEV_FRONTEND_URL || 'http://localhost:5173';

console.log(`[Midtrans] Mode: ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`);

// ============================================================
// INISIALISASI MIDTRANS SNAP
// ============================================================
const snap = new midtransClient.Snap({
  isProduction,
  serverKey: SERVER_KEY,
  clientKey: CLIENT_KEY,
});

// ============================================================
// HELPER: Verifikasi Signature Webhook Midtrans
// ============================================================
const verifyMidtransSignature = (orderId, statusCode, grossAmount, signatureKey) => {
  const hash = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
    .digest('hex');
  return hash === signatureKey;
};

// ============================================================
// HELPER: Hitung durasi display overlay
// ============================================================
const getDisplayDuration = (amount, overlaySetting) => {
  const tiers = overlaySetting?.durationTiers || [];
  if (tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount);
    for (const tier of sorted) {
      if (amount >= tier.minAmount && (tier.maxAmount === null || amount <= tier.maxAmount)) {
        return tier.duration * 1000;
      }
    }
  }
  const base = overlaySetting?.baseDuration || 8;
  return base * 1000;
};

// ============================================================
// CREATE DONATION
// ============================================================
exports.createDonation = async (req, res) => {
  const { amount, donorName, message, userId, email, mediaUrl, mediaType } = req.body;

  if (!amount || !userId) {
    return res.status(400).json({ message: 'Amount dan userId wajib diisi' });
  }

  const orderId = `donasi-${userId}-${Date.now()}`;

  try {
    const streamer = await User.findById(userId).lean();
    const streamerUsername = streamer?.username || userId;

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.round(Number(amount)),
      },
      customer_details: {
        first_name: donorName || 'Anonim',
        email: email || 'guest@mail.com',
      },
      item_details: [
        {
          id: 'DONASI',
          price: Math.round(Number(amount)),
          quantity: 1,
          name: `Donasi untuk @${streamerUsername}`,
        },
      ],
      callbacks: {
        finish: `${BASE_URL}/donation/success?username=${streamerUsername}`,
        error: `${BASE_URL}/donation/failed?username=${streamerUsername}`,
        pending: `${BASE_URL}/donation/pending?username=${streamerUsername}`,
      },
    };

    const snapResponse = await snap.createTransaction(parameter);

    const { blocked, filtered } = await filterMessage(userId, message);
    if (blocked) {
      return res.status(400).json({ message: 'Pesanmu mengandung kata yang tidak diizinkan oleh streamer ini.' });
    }

    await Donation.create({
      externalId: orderId,
      userId,
      amount: Math.round(Number(amount)),
      donorName: donorName || 'Anonim',
      message: filtered || '',
      paymentUrl: snapResponse.redirect_url,
      status: 'PENDING',
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || 'image',
    });

    res.json({ url: snapResponse.redirect_url, token: snapResponse.token });
  } catch (err) {
    console.error('[Midtrans Error]:', err);
    res.status(500).json({ message: 'Midtrans Error', details: err?.ApiResponse || err.message });
  }
};

// ============================================================
// WEBHOOK — NOTIFIKASI TRANSAKSI MIDTRANS
// ============================================================
exports.handleWebhook = async (req, res) => {
  console.log('\n========== [WEBHOOK MIDTRANS MASUK] ==========');

  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = req.body;

  const isValid = verifyMidtransSignature(order_id, status_code, gross_amount, signature_key);
  if (!isValid) {
    console.warn('[Webhook] Signature tidak valid');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const isSuccess =
    transaction_status === 'settlement' ||
    (transaction_status === 'capture' && fraud_status === 'accept');

  if (isSuccess) {
    try {
      const dataDonasi = await Donation.findOneAndUpdate(
        { externalId: order_id, status: 'PENDING' },
        { $set: { status: 'PAID' } },
        { new: true }
      ).populate('userId');

      if (!dataDonasi) {
        console.log(`[Webhook] Duplikat/tidak ditemukan: ${order_id} — skip`);
        return res.status(200).json({ message: 'OK' });
      }

      const streamer = dataDonasi.userId;
      if (!streamer) {
        console.warn('[Webhook] Streamer tidak ditemukan');
        return res.status(200).json({ message: 'OK' });
      }

      await User.findByIdAndUpdate(streamer._id, { $inc: { walletBalance: parseFloat(dataDonasi.amount) } });
      console.log(`[Webhook] Wallet @${streamer.username} +Rp${dataDonasi.amount}`);

      try {
        const subathonResult = await subathonCtrl.handleDonationPaid(streamer._id, dataDonasi.amount);
        if (subathonResult) {
          const io = req.app.get('socketio');
          if (io) io.to(streamer.overlayToken).emit('subathon-updated', subathonResult.timer);
        }
      } catch (subErr) {
        console.error('[Webhook] Subathon error:', subErr.message);
      }

      const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
      const soundUrl = overlaySetting?.getSoundForAmount
        ? overlaySetting.getSoundForAmount(dataDonasi.amount)
        : (overlaySetting?.soundUrl || null);
      const displayDuration = getDisplayDuration(dataDonasi.amount, overlaySetting);

      const io = req.app.get('socketio');
      if (io && streamer.overlayToken) {
        const payload = {
          donorName: dataDonasi.donorName,
          amount: dataDonasi.amount,
          message: dataDonasi.message,
          mediaUrl: dataDonasi.mediaUrl || null,
          mediaType: dataDonasi.mediaType || 'image',
          receivedAt: new Date().toISOString(),
          soundUrl,
          queuePosition: donationQueue.getQueueLength(streamer.overlayToken) + 1,
        };
        donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);
        console.log(`[Webhook] Donasi "${dataDonasi.donorName}" masuk antrian overlay @${streamer.username}`);
      }

    } catch (err) {
      console.error('[Webhook] Error:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  if (transaction_status === 'expire') {
    await Donation.findOneAndUpdate(
      { externalId: order_id, status: 'PENDING' },
      { $set: { status: 'EXPIRED' } }
    );
    console.log(`[Webhook] Donasi ${order_id} => EXPIRED`);
  }

  console.log('========== [WEBHOOK SELESAI] ==========\n');
  return res.status(200).json({ message: 'OK' });
};

// ============================================================
// REQUEST WITHDRAWAL — MANUAL
// Streamer ajukan request => Admin approve/reject secara manual
// Aturan:
//   - Saldo minimum Rp 20.000 untuk bisa tarik
//   - Minimal tarik Rp 10.000
//   - Maksimal tarik Rp 10.000.000 per transaksi
//   - Fee admin Rp 5.000 dipotong dari saldo
// ============================================================
exports.requestWithdrawal = async (req, res) => {
  const { amount, paymentMethod, channelCode, accountNumber, accountName } = req.body;
  const userId = req.user.id;

  const amt = parseFloat(amount);

  // Validasi input
  if (!amount || isNaN(amt) || amt <= 0)
    return res.status(400).json({ message: 'Nominal tidak valid' });
  if (amt < 10000)
    return res.status(400).json({ message: 'Minimal penarikan adalah Rp 10.000' });
  if (amt > 10000000)
    return res.status(400).json({ message: 'Maksimal penarikan adalah Rp 10.000.000 per transaksi' });
  if (!channelCode || !accountNumber || !accountName)
    return res.status(400).json({ message: 'Data rekening/e-wallet tidak lengkap' });

  const FEE = 5000;
  const totalDeduct = amt + FEE;
  const MIN_BALANCE = 20000;
  const referenceNo = `wd-${userId}-${Date.now()}`;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Atomic: cek saldo >= max(totalDeduct, MIN_BALANCE) lalu potong
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        walletBalance: { $gte: Math.max(totalDeduct, MIN_BALANCE) },
      },
      { $inc: { walletBalance: -totalDeduct } },
      { new: true, session }
    );

    if (!user) {
      await session.abortTransaction();
      session.endSession();

      const existingUser = await User.findById(userId);
      if (!existingUser)
        return res.status(404).json({ message: 'User tidak ditemukan' });

      const currentBalance = parseFloat(existingUser.walletBalance || 0);
      if (currentBalance < MIN_BALANCE)
        return res.status(400).json({
          message: `Saldo minimum untuk penarikan adalah Rp 20.000. Saldo kamu saat ini Rp ${currentBalance.toLocaleString('id-ID')}`,
        });

      return res.status(400).json({
        message: `Saldo tidak mencukupi. Dibutuhkan Rp ${totalDeduct.toLocaleString('id-ID')} (termasuk biaya admin Rp 5.000)`,
      });
    }

    await Withdrawal.create([{
      userId,
      amount: amt,
      paymentMethod: paymentMethod || 'BANK',
      channelCode,
      accountNumber,
      accountName,
      status: 'PENDING',
      midtransReference: referenceNo,
      note: null,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    console.log(`[requestWithdrawal] @${user.username} ajukan WD Rp${amt} via ${channelCode} — menunggu approval admin`);

    res.json({
      message: 'Permintaan penarikan berhasil diajukan. Dana akan diproses admin dalam 1x24 jam.',
      referenceNo,
      status: 'PENDING',
    });

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error('[requestWithdrawal] Error:', err);
    res.status(500).json({ message: 'Terjadi kesalahan sistem', error: err.message });
  }
};

// ============================================================
// GET WITHDRAWAL HISTORY — Untuk Streamer
// Menampilkan semua riwayat withdrawal milik streamer (semua status)
// ============================================================
exports.getWithdrawalHistory = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Withdrawal.countDocuments({ userId }),
    ]);

    res.json({
      withdrawals,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[getWithdrawalHistory] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// [ADMIN] GET SEMUA WITHDRAWAL
// Query param: ?status=PENDING|COMPLETED|FAILED (kosong = semua)
// ============================================================
exports.adminGetPendingWithdrawals = async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;

  try {
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(filter)
        .populate('userId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Withdrawal.countDocuments(filter),
    ]);

    res.json({
      withdrawals,
      pagination: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[adminGetPendingWithdrawals] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// [ADMIN] APPROVE atau REJECT WITHDRAWAL
//
// COMPLETED = admin sudah transfer manual
//   => update status, kirim notif realtime ke streamer via socket
//
// FAILED = ditolak admin
//   => kembalikan saldo (amount + fee) ke streamer
//   => kirim notif realtime ke streamer via socket
//   => simpan note/alasan penolakan
// ============================================================
exports.adminUpdateWithdrawal = async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;

  if (!['COMPLETED', 'FAILED'].includes(status)) {
    return res.status(400).json({ message: 'Status harus COMPLETED atau FAILED' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const withdrawal = await Withdrawal.findById(id).populate('userId').session(session);

    if (!withdrawal) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Withdrawal tidak ditemukan' });
    }

    if (withdrawal.status !== 'PENDING') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Withdrawal sudah berstatus ${withdrawal.status}` });
    }

    // Update status & note
    withdrawal.status = status;
    withdrawal.note = note || null;
    await withdrawal.save({ session });

    const streamer = withdrawal.userId;
    const io = req.app.get('socketio');

    if (status === 'COMPLETED') {
      // Admin sudah transfer manual — tidak ada potong saldo lagi, hanya notif
      console.log(`[adminUpdateWithdrawal] APPROVED — WD #${id} @${streamer?.username} Rp${withdrawal.amount}`);

      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'COMPLETED',
          amount: withdrawal.amount,
          channelCode: withdrawal.channelCode,
          accountNumber: withdrawal.accountNumber,
          message: `Penarikan Rp ${Number(withdrawal.amount).toLocaleString('id-ID')} telah berhasil ditransfer ke rekening kamu!`,
        });
      }

    } else if (status === 'FAILED') {
      // Refund: kembalikan amount + fee ke saldo streamer
      const refundAmount = parseFloat(withdrawal.amount) + 5000;

      if (streamer) {
        await User.findByIdAndUpdate(
          streamer._id,
          { $inc: { walletBalance: refundAmount } },
          { session }
        );
        console.log(`[adminUpdateWithdrawal] REJECTED — Rp${refundAmount} dikembalikan ke @${streamer.username}`);
      }

      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'FAILED',
          amount: withdrawal.amount,
          message: `Penarikan ditolak. Rp ${Number(refundAmount).toLocaleString('id-ID')} (termasuk fee) dikembalikan ke saldo kamu.${note ? ` Alasan: ${note}` : ''}`,
        });
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.json({ message: `Withdrawal berhasil diupdate ke ${status}` });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[adminUpdateWithdrawal] Error:', err);
    res.status(500).json({ error: err.message });
  }
};