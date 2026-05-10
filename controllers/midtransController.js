// controllers/midtransController.js
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Donation, Withdrawal, User, OverlaySetting } = require('../models');
const { filterMessage } = require('./bannedWordController');
const subathonCtrl = require('./subathonController');
const axios = require('axios');
const { donationQueue } = require('../utils/donationQueue');
require('dotenv').config();



// ============================================================
// DETEKSI ENVIRONMENT
// ============================================================
const FLIP_AUTH = Buffer.from(`${process.env.FLIP_SECRET_KEY}:`).toString('base64');
const FLIP_URL = process.env.FLIP_BASE_URL;

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

console.log(`[Midtrans] Mode: ${isProduction ? 'PRODUCTION 🚀' : 'SANDBOX 🧪'}`);
console.log('[createDonation] NODE_ENV:', process.env.NODE_ENV);
console.log('[createDonation] isProduction:', isProduction);
console.log('[createDonation] SERVER_KEY prefix:', SERVER_KEY?.substring(0, 25));

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
// CREATE DONATION
// ============================================================
exports.createDonation = async (req, res) => {
  const { amount, donorName, message, userId, email, mediaUrl, mediaType } = req.body;

  if (!amount || !userId) {
    return res.status(400).json({ message: 'Amount dan userId wajib diisi' });
  }

  const orderId = `donasi-${userId}-${Date.now()}`;

  try {
    const streamer = await User.findById(userId).lean();  // ← findById bukan findByPk
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
      mediaType: mediaType || 'image'
    });

    res.json({
      url: snapResponse.redirect_url,
      token: snapResponse.token,
    });
  } catch (err) {
    console.error('[Midtrans Error]:', err);
    res.status(500).json({
      message: 'Midtrans Error',
      details: err?.ApiResponse || err.message,
    });
  }
};

// ============================================================
// WEBHOOK — NOTIFIKASI TRANSAKSI
// ============================================================
// exports.handleWebhook = async (req, res) => {
//   console.log('\n========== [WEBHOOK MIDTRANS MASUK] ==========');
//   console.log('[Webhook] Body:', JSON.stringify(req.body, null, 2));

//   const {
//     order_id,
//     status_code,
//     gross_amount,
//     signature_key,
//     transaction_status,
//     fraud_status,
//     payment_type,
//   } = req.body;

//   // 1. Verifikasi signature
//   const isValid = verifyMidtransSignature(order_id, status_code, gross_amount, signature_key);
//   console.log(`[Webhook] Signature valid: ${isValid}`);

//   if (!isValid) {
//     console.warn('[Webhook] ❌ Signature tidak valid — request ditolak');
//     return res.status(401).json({ message: 'Unauthorized' });
//   }

//   console.log(`[Webhook] order_id: ${order_id}`);
//   console.log(`[Webhook] transaction_status: ${transaction_status}`);
//   console.log(`[Webhook] fraud_status: ${fraud_status}`);
//   console.log(`[Webhook] payment_type: ${payment_type}`);

//   // 2. Cek apakah sukses
//   const isSuccess =
//     transaction_status === 'settlement' ||
//     (transaction_status === 'capture' && fraud_status === 'accept');

//   console.log(`[Webhook] isSuccess: ${isSuccess}`);

//   if (isSuccess) {
//     try {
//       // 3. Cari donasi di DB (populate User menggantikan include Sequelize)
//       console.log(`[Webhook] Mencari donasi dengan externalId: ${order_id}`);
//       const dataDonasi = await Donation.findOne({ externalId: order_id }).populate('userId');

//       if (!dataDonasi) {
//         console.warn(`[Webhook] ❌ Donasi tidak ditemukan di DB untuk order_id: ${order_id}`);
//         return res.status(200).json({ message: 'OK' });
//       }

//       console.log(`[Webhook] ✅ Donasi ditemukan: ID=${dataDonasi._id}, status saat ini=${dataDonasi.status}`);

//       // 4. Idempotency check
//       if (dataDonasi.status === 'PAID') {
//         console.log(`[Webhook] ⚠️ Donasi sudah PAID sebelumnya — skip`);
//         return res.status(200).json({ message: 'OK' });
//       }

//       // 5. Update status donasi + wallet streamer dalam satu MongoDB session (transaction)
//       const session = await mongoose.startSession();
//       session.startTransaction();

//       try {
//         dataDonasi.status = 'PAID';
//         await dataDonasi.save({ session });
//         console.log(`[Webhook] ✅ Status donasi diupdate ke PAID`);

//         // 6. Update wallet streamer
//         // dataDonasi.userId sudah berisi dokumen User karena .populate('userId')
//         const streamer = dataDonasi.userId;
//         if (!streamer) {
//           await session.abortTransaction();
//           session.endSession();
//           console.warn(`[Webhook] ❌ User/streamer tidak ditemukan untuk donasi ini`);
//           return res.status(200).json({ message: 'OK' });
//         }

//         const walletBefore = parseFloat(streamer.walletBalance || 0);
//         // $inc lebih aman untuk concurrent update
//         await User.findByIdAndUpdate(
//           streamer._id,
//           { $inc: { walletBalance: parseFloat(dataDonasi.amount) } },
//           { session }
//         );

//         await session.commitTransaction();
//         session.endSession();

//         const walletAfter = walletBefore + parseFloat(dataDonasi.amount);
//         console.log(`[Webhook] ✅ Wallet @${streamer.username}: Rp${walletBefore} → Rp${walletAfter}`);

//         // 7. Emit socket ke overlay
//         console.log(`[Webhook] Mencoba emit socket ke overlay token: ${streamer.overlayToken}`);

//         try {
//           const io = req.app.get('socketio');

//           if (!io) {
//             console.error('[Webhook] ❌ socketio tidak ditemukan di app');
//           } else {
//             const room = streamer.overlayToken;
//             const socketsInRoom = await io.in(room).fetchSockets();
//             console.log(`[Webhook] Jumlah client di room "${room}": ${socketsInRoom.length}`);

//             if (socketsInRoom.length === 0) {
//               console.warn(`[Webhook] ⚠️ Tidak ada client yang terkoneksi di room "${room}"`);
//             }

//             const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
//             const soundUrl = overlaySetting?.getSoundForAmount
//               ? overlaySetting.getSoundForAmount(dataDonasi.amount)
//               : (overlaySetting?.soundUrl || null);

//             const payload = {
//               donorName: dataDonasi.donorName,
//               amount: dataDonasi.amount,
//               message: dataDonasi.message,
//               mediaUrl: dataDonasi.mediaUrl || null,   // ← dari donor
//               mediaType: dataDonasi.mediaType || 'image',
//               receivedAt: new Date().toISOString(),
//               soundUrl
//             };

//             io.to(room).emit('new-donation', payload);
//             const subathonResult = await subathonCtrl.handleDonationPaid(
//               streamer._id, 
//               dataDonasi.amount
//             );
//             if (subathonResult) {
//               io.to(room).emit('subathon-updated', subathonResult.timer);
//               console.log(`[Webhook] ✅ Subathon +${subathonResult.added}s ditambahkan`);
//             }

//             console.log(`[Webhook] ✅ Socket emit "new-donation" ke room "${room}":`, payload);
//           }
//         } catch (socketErr) {
//           console.error('[Webhook] ❌ Socket emit gagal:', socketErr.message);
//         }

//       } catch (txErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error('[Webhook] ❌ Transaction gagal:', txErr);
//       }

//     } catch (err) {
//       console.error('[Webhook] ❌ Error saat proses PAID:', err);
//     }
//   }

//   // 8. Handle expire
//   if (transaction_status === 'expire') {
//     console.log(`[Webhook] Donasi expired: ${order_id}`);
//     try {
//       const result = await Donation.updateOne(
//         { externalId: order_id, status: 'PENDING' },
//         { status: 'EXPIRED' }
//       );
//       console.log(`[Webhook] ✅ ${result.modifiedCount} donasi diupdate ke EXPIRED`);
//     } catch (err) {
//       console.error('[Webhook] ❌ Gagal update EXPIRED:', err);
//     }
//   }

//   console.log('========== [WEBHOOK SELESAI] ==========\n');
//   res.status(200).json({ message: 'OK' });
// };

exports.handleWebhook = async (req, res) => {
  console.log('\n========== [WEBHOOK MIDTRANS MASUK] ==========');
 
  const {
    order_id,
    status_code,
    gross_amount,
    signature_key,
    transaction_status,
    fraud_status,
  } = req.body;
 
  // 1. Verifikasi signature
  const isValid = verifyMidtransSignature(order_id, status_code, gross_amount, signature_key);
  if (!isValid) {
    console.warn('[Webhook] ❌ Signature tidak valid');
    return res.status(401).json({ message: 'Unauthorized' });
  }
 
  const isSuccess =
    transaction_status === 'settlement' ||
    (transaction_status === 'capture' && fraud_status === 'accept');
 
  if (isSuccess) {
    try {
      // 2. ATOMIC idempotency check — hanya update jika masih PENDING
      const dataDonasi = await Donation.findOneAndUpdate(
        { externalId: order_id, status: 'PENDING' },
        { $set: { status: 'PAID' } },
        { new: true }
      ).populate('userId');
 
      // Null = duplikat webhook atau tidak ditemukan → skip
      if (!dataDonasi) {
        console.log(`[Webhook] ⚠️ Duplikat/tidak ditemukan: ${order_id} — skip`);
        return res.status(200).json({ message: 'OK' });
      }
 
      const streamer = dataDonasi.userId;
      if (!streamer) {
        console.warn('[Webhook] ❌ Streamer tidak ditemukan');
        return res.status(200).json({ message: 'OK' });
      }
 
      // 3. Update wallet — $inc atomic, aman concurrent
      await User.findByIdAndUpdate(
        streamer._id,
        { $inc: { walletBalance: parseFloat(dataDonasi.amount) } }
      );
 
      console.log(`[Webhook] ✅ Wallet @${streamer.username} +Rp${dataDonasi.amount}`);
 
      // 4. Subathon — update timer (atomic di subathonController)
      try {
        const subathonResult = await subathonCtrl.handleDonationPaid(
          streamer._id,
          dataDonasi.amount
        );
 
        // Emit subathon langsung (tidak perlu queue, bukan alert visual)
        if (subathonResult) {
          const io = req.app.get('socketio');
          if (io) {
            io.to(streamer.overlayToken).emit('subathon-updated', subathonResult.timer);
            console.log(`[Webhook] ✅ Subathon +${subathonResult.added}s`);
          }
        }
      } catch (subErr) {
        console.error('[Webhook] ❌ Subathon error:', subErr.message);
      }
 
      // 5. Ambil overlay settings untuk durasi alert
      const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
      const soundUrl = overlaySetting?.getSoundForAmount
        ? overlaySetting.getSoundForAmount(dataDonasi.amount)
        : (overlaySetting?.soundUrl || null);
 
      const displayDuration = getDisplayDuration(dataDonasi.amount, overlaySetting);
 
      // 6. MASUKKAN KE QUEUE — bukan langsung emit
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
          // Info antrian untuk frontend (opsional)
          queuePosition: donationQueue.getQueueLength(streamer.overlayToken) + 1,
        };
 
        donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);
 
        console.log(
          `[Webhook] ✅ Donasi "${dataDonasi.donorName}" masuk antrian overlay @${streamer.username}`
        );
      }
 
    } catch (err) {
      console.error('[Webhook] ❌ Error:', err);
      // Return 500 agar Midtrans retry
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }
 
  // Handle expire
  if (transaction_status === 'expire') {
    await Donation.findOneAndUpdate(
      { externalId: order_id, status: 'PENDING' },
      { $set: { status: 'EXPIRED' } }
    );
    console.log(`[Webhook] ✅ Donasi ${order_id} → EXPIRED`);
  }
 
  console.log('========== [WEBHOOK SELESAI] ==========\n');
  return res.status(200).json({ message: 'OK' });
};

// ============================================================
// REQUEST WITHDRAWAL — Manual
// ============================================================
// exports.requestWithdrawal = async (req, res) => {
//   const { amount, paymentMethod, channelCode, accountNumber, accountName } = req.body;
//   const userId = req.user.id;

//   if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
//     return res.status(400).json({ message: 'Nominal tidak valid' });
//   }
//   if (parseFloat(amount) < 10000) {
//     return res.status(400).json({ message: 'Minimal penarikan adalah Rp 10.000' });
//   }
//   if (!channelCode || !accountNumber || !accountName) {
//     return res.status(400).json({ message: 'Data rekening/e-wallet tidak lengkap' });
//   }

//   const FEE = 500;
//   const totalDeduct = parseFloat(amount) + FEE;

//   // Gunakan MongoDB session untuk atomic transaction
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     // findOneAndUpdate dengan $inc lebih aman untuk concurrent request
//     // Cek saldo sekaligus kurangi dalam satu query atomic menggunakan kondisi walletBalance
//     const user = await User.findOneAndUpdate(
//       {
//         _id: userId,
//         walletBalance: { $gte: totalDeduct }, // hanya update jika saldo cukup
//       },
//       { $inc: { walletBalance: -totalDeduct } },
//       { new: true, session }
//     );

//     if (!user) {
//       await session.abortTransaction();
//       session.endSession();
//       // Cek apakah user ada atau saldo tidak cukup
//       const existingUser = await User.findById(userId);
//       if (!existingUser) {
//         return res.status(404).json({ message: 'User tidak ditemukan' });
//       }
//       return res.status(400).json({
//         message: `Saldo tidak mencukupi. Dibutuhkan Rp ${totalDeduct.toLocaleString('id-ID')} (termasuk biaya admin Rp 5.000)`,
//       });
//     }

//     const referenceNo = `wd-${userId}-${Date.now()}`;

//     await Withdrawal.create(
//       [{
//         userId,
//         amount: parseFloat(amount),
//         paymentMethod,
//         channelCode,
//         accountNumber,
//         accountName,
//         status: 'PENDING',
//         midtransReference: referenceNo,
//       }],
//       { session }
//     );

//     await session.commitTransaction();
//     session.endSession();

//     console.log(`[requestWithdrawal] @${user.username} request WD Rp${amount} via ${channelCode}`);

//     res.json({
//       message: 'Permintaan penarikan berhasil diajukan. Dana akan ditransfer admin dalam 1x24 jam.',
//       referenceNo,
//     });
//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error('[requestWithdrawal] Unexpected error:', err);
//     res.status(500).json({ error: err.message });
//   }
// };

exports.requestWithdrawal = async (req, res) => {
  const { amount, channelCode, accountNumber, accountName } = req.body;
  const userId = req.user.id;

  // 1. Validasi Input Dasar
  if (!amount || isNaN(amount) || parseFloat(amount) < 10000) {
    return res.status(400).json({ message: 'Minimal penarikan adalah Rp 10.000' });
  }

  const FEE = 5000; // Sesuaikan dengan biaya Flip (biasanya Rp 4.000 - 5.000)
  const totalDeduct = parseFloat(amount) + FEE;
  const referenceNo = `wd-${userId}-${Date.now()}`;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Cek Saldo & Potong (Atomic)
    const user = await User.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: totalDeduct } },
      { $inc: { walletBalance: -totalDeduct } },
      { new: true, session }
    );

    if (!user) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // 3. Simpan record withdrawal dengan status 'PROCESSING'
    const withdrawal = await Withdrawal.create([{
      userId,
      amount: parseFloat(amount),
      channelCode, // e.g., 'bca', 'bni', 'gopay'
      accountNumber,
      accountName,
      status: 'PENDING',
      midtransReference: referenceNo, // Kita gunakan ini sebagai external_id di Flip
    }], { session });

    // 4. Tembak API Flip (Disbursement)
    // Kita lakukan ini DI LUAR session commit jika ingin memastikan data tersimpan dulu, 
    // tapi karena kita ingin otomatis, kita panggil API-nya sekarang.
    try {
      const flipPayload = {
        account_number: accountNumber,
        bank_code: channelCode.toLowerCase(),
        amount: Math.round(Number(amount)),
        remark: `Withdrawal @${user.username}`,
        recipient_city: '441', // Default Kode Kota (e.g. Jakarta)
        beneficiary_email: user.email,
        external_id: referenceNo
      };

      const flipRes = await axios.post(`${FLIP_URL}/disbursements`, 
        new URLSearchParams(flipPayload), 
        {
          headers: {
            'Authorization': `Basic ${FLIP_AUTH}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      // Jika Flip berhasil menerima request
      await session.commitTransaction();
      session.endSession();

      return res.json({
        message: 'Penarikan sedang diproses oleh sistem.',
        status: flipRes.data.status, // Biasanya 'PENDING' di level Flip
        referenceNo
      });

    } catch (flipErr) {
      // Jika API Flip menolak (rekening salah, bank down, dll)
      console.error('[Flip Error]:', flipErr.response?.data || flipErr.message);
      await session.abortTransaction(); // Batalkan pemotongan saldo
      session.endSession();
      
      return res.status(400).json({ 
        message: 'Gagal memproses ke sistem bank. Pastikan data rekening benar.',
        details: flipErr.response?.data?.errors?.[0]?.message || 'Service Unavailable'
      });
    }

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    
    const msg = err.message === 'INSUFFICIENT_BALANCE' 
      ? 'Saldo tidak mencukupi' 
      : 'Terjadi kesalahan sistem';
    res.status(err.message === 'INSUFFICIENT_BALANCE' ? 400 : 500).json({ message: msg });
  }
}

exports.handleFlipWebhook = async (req, res) => {
  const { data, token } = req.body;

  if (token !== process.env.FLIP_VALIDATION_TOKEN) {
    return res.status(401).send('Unauthorized');
  }

  // Safeguard: handle string atau object
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  const externalId = payload.external_id;
  const status = payload.status; // DONE, CANCELLED

  try {
    const withdrawal = await Withdrawal.findOne({ 
      midtransReference: externalId 
    }).populate('userId');
    
    if (!withdrawal) return res.status(200).send('OK');

    const io = req.app.get('socketio'); // ← ambil socket
    const streamer = withdrawal.userId;

    if (status === 'DONE') {
      withdrawal.status = 'COMPLETED';
      await withdrawal.save();
      console.log(`[Flip Webhook] WD ${externalId} SUCCESS`);

      // ✅ Notifikasi ke streamer via socket
      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'COMPLETED',
          amount: withdrawal.amount,
          accountNumber: withdrawal.accountNumber,
          channelCode: withdrawal.channelCode,
          message: `Penarikan Rp ${Number(withdrawal.amount).toLocaleString('id-ID')} berhasil dikirim ke rekening kamu!`,
        });
      }

    } else if (status === 'CANCELLED') {
      const refundAmount = withdrawal.amount + 5000;
      await User.findByIdAndUpdate(streamer._id, {
        $inc: { walletBalance: refundAmount }
      });

      withdrawal.status = 'FAILED';
      await withdrawal.save();
      console.log(`[Flip Webhook] WD ${externalId} FAILED - Saldo dikembalikan`);

      // ✅ Notifikasi gagal + saldo dikembalikan
      if (io && streamer?.overlayToken) {
        io.to(streamer.overlayToken).emit('withdrawal-update', {
          status: 'FAILED',
          amount: withdrawal.amount,
          message: `Penarikan gagal. Rp ${Number(refundAmount).toLocaleString('id-ID')} dikembalikan ke saldo kamu.`,
        });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[Flip Webhook Error]:', err);
    res.status(500).send('Error');
  }
};

const getDisplayDuration = (amount, overlaySetting) => {
  const tiers = overlaySetting?.durationTiers || [];
 
  if (tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount);
    for (const tier of sorted) {
      if (
        amount >= tier.minAmount &&
        (tier.maxAmount === null || amount <= tier.maxAmount)
      ) {
        return tier.duration * 1000; // konversi detik → ms
      }
    }
  }
 
  // Fallback default
  const base = overlaySetting?.baseDuration || 8;
  return base * 1000;
};

// ============================================================
// GET WITHDRAWAL HISTORY
// ============================================================
exports.getWithdrawalHistory = async (req, res) => {
  const userId = req.user.id;
  try {
    const withdrawals = await Withdrawal.find({ userId })
      .sort({ createdAt: -1 })  // ← sort bukan order
      .limit(20);
    res.json(withdrawals);
  } catch (err) {
    console.error('[getWithdrawalHistory] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// [ADMIN] GET SEMUA PENDING WITHDRAWAL
// ============================================================
exports.adminGetPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: 'PENDING' })
      .populate('userId', 'username email')  // ← populate menggantikan include
      .sort({ createdAt: 1 });
    res.json(withdrawals);
  } catch (err) {
    console.error('[adminGetPendingWithdrawals] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================
// [ADMIN] UPDATE STATUS WITHDRAWAL
// ============================================================
exports.adminUpdateWithdrawal = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['COMPLETED', 'FAILED'].includes(status)) {
    return res.status(400).json({ message: 'Status harus COMPLETED atau FAILED' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const withdrawal = await Withdrawal.findById(id)
      .populate('userId')
      .session(session);

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

    withdrawal.status = status;
    await withdrawal.save({ session });

    // Jika FAILED, kembalikan dana ke wallet user
    if (status === 'FAILED') {
      const user = withdrawal.userId; // sudah ter-populate
      if (user) {
        const refundAmount = parseFloat(withdrawal.amount) + 5000;
        await User.findByIdAndUpdate(
          user._id,
          { $inc: { walletBalance: refundAmount } },
          { session }
        );
        console.log(`[adminUpdateWithdrawal] FAILED — Rp${refundAmount} dikembalikan ke @${user.username}`);
      }
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`[adminUpdateWithdrawal] WD #${id} → ${status}`);
    res.json({ message: `Withdrawal diupdate ke ${status}` });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[adminUpdateWithdrawal] Error:', err);
    res.status(500).json({ error: err.message });
  }
};