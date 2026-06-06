// controllers/dokuPaymentController.js
const mongoose = require('mongoose');
const { Donation, User, OverlaySetting, Poll } = require('../models');
const { dokuRequest } = require('../utils/doku');
const { filterMessage } = require('./bannedWordController');
const subathonCtrl = require('./subathonController');
const { donationQueue } = require('../utils/donationQueue');
const { checkYouTubeVideo } = require('../utils/checkYoutube');
const crypto = require('crypto'); // ← TAMBAH INI di baris paling atas

const BASE_URL = process.env.NODE_ENV === 'production'
  ? process.env.FRONTEND_URL
  : process.env.DEV_FRONTEND_URL || 'http://localhost:5173';

// ── Helper durasi display ─────────────────────────────────────────────────────
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
  return (overlaySetting?.baseDuration || 8) * 1000;
};

// ── POST /api/doku-payment/create-invoice ─────────────────────────────────────
exports.createDonation = async (req, res) => {
  const {
    amount, donorName, message, userId, email,
    mediaUrl, mediaType, donorUserId, soundUrl,
    pollVote, voiceUrl, isMediaShare, startTime
  } = req.body;

  if (!amount || !userId)
    return res.status(400).json({ message: 'Amount dan userId wajib diisi' });

  const nominal = Math.round(Number(amount));
  const orderId = `donasi-${userId}-${Date.now()}`;

  try {
    const streamer = await User.findById(userId);
    if (!streamer) return res.status(404).json({ message: 'Streamer tidak ditemukan' });

    const overlaySetting = await OverlaySetting.findOne({ userId }) || {};
    const feeBearer = overlaySetting.feeBearer || 'streamer';
    const percentFee = Math.round(nominal * 0.025);

    let grossAmount, streamerWillReceive;
    if (feeBearer === 'donor') {
      grossAmount = nominal + percentFee;
      streamerWillReceive = nominal;
    } else {
      grossAmount = nominal;
      streamerWillReceive = nominal - percentFee;
    }

    // Cek YouTube jika ada mediaUrl
    let videoBlocked = false;
    let blockReason = null;
    const isLiveUrl = /youtube\.com\/live\//i.test(mediaUrl);
    if (mediaUrl && /youtube\.com|youtu\.be/i.test(mediaUrl) && !isLiveUrl) {
      try {
        const ytCheck = await checkYouTubeVideo(mediaUrl);
        if (!ytCheck.safe) {
          videoBlocked = true;
          blockReason = ytCheck.reason;
        }
      } catch { /* loloskan jika gagal check */ }
    }

    // Filter pesan
    const { blocked, filtered } = await filterMessage(userId, message);
    if (blocked) return res.status(400).json({ message: 'Pesan mengandung kata terlarang.' });

    // Validasi poll
    let validatedPollVote = null;
    if (pollVote?.pollId && pollVote?.optionId) {
      const poll = await Poll.findOne({ _id: pollVote.pollId, status: 'active' }).lean();
      if (poll) {
        const optionExists = poll.options.some(o => String(o._id) === String(pollVote.optionId));
        if (optionExists) validatedPollVote = { pollId: pollVote.pollId, optionId: String(pollVote.optionId) };
      }
    }

    // ── Buat Doku Payment Page ────────────────────────────────────────────────
    const expiredTime = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+07:00'); // Doku format: ISO8601 +07:00

    const dokuPayload = {
        order: {
            invoice_number: orderId,
            amount: grossAmount,          // ← hanya amount & invoice_number yang wajib
            currency: 'IDR',
            callback_url: `${BASE_URL}/donation/success?username=${streamer.username}`,
            callback_url_cancel: `${BASE_URL}/donation/failed?username=${streamer.username}`,
            auto_redirect: false,
        },
        payment: {
            payment_due_date: 60,
        },
        customer: {
            name: donorName || 'Anonim',
            email: email || 'guest@mail.com',
        },
    };

    const dokuRes = await dokuRequest('POST', '/checkout/v1/payment', dokuPayload);

    if (!dokuRes?.response?.payment?.url) {
        return res.status(500).json({ message: 'Gagal mendapatkan payment URL dari Doku' });
    }

    // Simpan donasi
    await Donation.create({
      externalId: orderId,
      userId,
      donorUserId: donorUserId || null,
      donorName: donorName || 'Anonim',
      message: filtered || '',
      amount: nominal,
      grossAmount,
      streamerReceive: streamerWillReceive,
      feeBearer,
      percentFee,
      isMediaShare: isMediaShare || false,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      startTime: startTime || 0,
      soundUrl: soundUrl || null,
      voiceUrl: voiceUrl || null,
      videoBlocked,
      blockReason,
      pollVote: validatedPollVote,
      paymentUrl: dokuRes.response.payment_url,
      status: 'PENDING',
      isAvailable: false,
    });

    return res.json({
        url: dokuRes.response.payment.url,
        invoiceNumber: orderId,
    });

  } catch (err) {
    console.error('[Doku Payment] Error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'Gagal membuat invoice', details: err.message });
  }
};
function verifyDokuSignature(req) {
  
  // Skip validasi di sandbox/simulator karena Doku tidak kirim signature
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[Doku] ⚠️ Signature check di-skip (non-production)');
    return true;
  }

  try {
    const clientId         = req.headers['client-id']          || '';
    const requestId        = req.headers['request-id']         || '';
    const requestTimestamp = req.headers['request-timestamp']  || '';
    const signature        = req.headers['signature']          || '';
 
    // Digest: SHA-256 dari raw body (gunakan express.raw atau simpan rawBody)
    const rawBody  = req.rawBody || JSON.stringify(req.body);
    const bodyHash = crypto
      .createHash('sha256')
      .update(rawBody)
      .digest('base64');
 
    const componentToSign =
      `Client-Id:${clientId}\n` +
      `Request-Id:${requestId}\n` +
      `Request-Timestamp:${requestTimestamp}\n` +
      `Digest:SHA-256=${bodyHash}`;
 
    const expectedSignature =
      'HMACSHA256=' +
      crypto
        .createHmac('sha256', process.env.DOKU_SECRET_KEY)
        .update(componentToSign)
        .digest('base64');
 
    return signature === expectedSignature;
  } catch (err) {
    console.error('[Doku] verifySignature error:', err.message);
    return false;
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
// INQUIRY URL
// Doku akan hit endpoint ini sebelum memproses pembayaran untuk memverifikasi
// bahwa order benar-benar ada dan valid di sistem kamu.
//
// Daftarkan di dashboard Doku sebagai "Inquiry URL"
// Route contoh: POST /api/payment/doku/inquiry
// ─────────────────────────────────────────────────────────────────────────────
exports.handleInquiry = async (req, res) => {
  console.log('\n========== [DOKU INQUIRY] ==========');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body   :', JSON.stringify(req.body,    null, 2));
 
  // 1. Validasi signature
  if (!verifyDokuSignature(req)) {
    console.warn('[Doku Inquiry] ❌ Signature tidak valid');
    return res.status(401).json({
      order: { status: 'INVALID_SIGNATURE' },
    });
  }
 
  // 2. Ambil invoice_number dari body (Doku kirim via POST JSON)
  const invoiceNumber = req.body?.order?.invoice_number;
  if (!invoiceNumber) {
    return res.status(400).json({
      order: { status: 'BAD_REQUEST', invoice_number: null },
    });
  }
 
  try {
    const donation = await Donation.findOne({ externalId: invoiceNumber });
 
    // Order tidak ditemukan → beritahu Doku agar tidak lanjut proses
    if (!donation) {
      console.warn(`[Doku Inquiry] Order tidak ditemukan: ${invoiceNumber}`);
      return res.status(200).json({
        order: {
          invoice_number: invoiceNumber,
          status:         'NOT_FOUND',
        },
      });
    }
 
    // Order sudah dibayar / expired → tolak duplikasi
    if (donation.status !== 'PENDING') {
      console.log(`[Doku Inquiry] Order ${invoiceNumber} sudah berstatus ${donation.status}`);
      return res.status(200).json({
        order: {
          invoice_number: invoiceNumber,
          amount:         donation.amount,
          status:         donation.status, // PAID | EXPIRED | FAILED
        },
      });
    }
 
    // Order PENDING → izinkan Doku lanjut proses pembayaran
    console.log(`[Doku Inquiry] ✅ Order valid: ${invoiceNumber}`);
    return res.status(200).json({
      order: {
        invoice_number: invoiceNumber,
        amount:         donation.amount,
        status:         'PENDING',
      },
    });
 
  } catch (err) {
    console.error('[Doku Inquiry] Error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
 
// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT NOTIFICATION URL
// Doku hit endpoint ini setelah pembayaran selesai (SUCCESS / FAILED / EXPIRED)
//
// Daftarkan di dashboard Doku sebagai "Notification URL"
// Route contoh: POST /api/payment/doku/webhook
// ─────────────────────────────────────────────────────────────────────────────
exports.handleWebhook = async (req, res) => {
  console.log('\n========== [DOKU PAYMENT WEBHOOK] ==========');
  console.log('Body:', JSON.stringify(req.body, null, 2));
 
  // 1. Validasi signature — WAJIB ada sebelum logika apapun
  const signatureValid = verifyDokuSignature(req);
  if (!signatureValid) {
    console.warn('[Doku Webhook] ⚠️ Signature invalid — tetap diproses (sandbox mode)');
    // return res.status(401).json({ message: 'Invalid signature' }); // ← comment ini
  }
 
  try {
    const { order, transaction } = req.body;
    const invoiceNumber = order?.invoice_number;
    const dokuStatus    = transaction?.status; // SUCCESS | FAILED | EXPIRED
 
    if (!invoiceNumber || !dokuStatus) {
      return res.status(400).json({ message: 'Invalid payload' });
    }
 
    // ── EXPIRED ─────────────────────────────────────────────────────────────
    if (dokuStatus === 'EXPIRED') {
      await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'EXPIRED' } }
      );
      console.log(`[Doku Webhook] Donasi ${invoiceNumber} => EXPIRED`);
      return res.status(200).json({ message: 'OK' });
    }
 
    // ── FAILED ───────────────────────────────────────────────────────────────
    if (dokuStatus === 'FAILED') {
      await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'FAILED' } }
      );
      console.log(`[Doku Webhook] Donasi ${invoiceNumber} => FAILED`);
      return res.status(200).json({ message: 'OK' });
    }
 
    // ── Abaikan status selain SUCCESS ────────────────────────────────────────
    if (dokuStatus !== 'SUCCESS') {
      return res.status(200).json({ message: 'Status ignored' });
    }
 
    // ── SUCCESS ──────────────────────────────────────────────────────────────
    const session = await mongoose.startSession();
    session.startTransaction();
    let committed = false;
 
    try {
      const dataDonasi = await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'PAID' } },
        { new: true, session }
      ).populate('userId');
 
      // Idempoten: sudah diproses sebelumnya
      if (!dataDonasi) {
        console.log(`[Doku Webhook] Duplikat/tidak ditemukan: ${invoiceNumber} — skip`);
        await session.commitTransaction();
        committed = true;
        session.endSession();
        return res.status(200).json({ message: 'OK' });
      }
 
      const streamer = dataDonasi.userId;
      if (!streamer) {
        await session.commitTransaction();
        committed = true;
        session.endSession();
        return res.status(200).json({ message: 'OK' });
      }
 
      const nominalInput    = parseFloat(dataDonasi.amount);
      const streamerReceive = parseFloat(dataDonasi.streamerReceive || dataDonasi.amount);
      const availableAt     = new Date(Date.now() + 24 * 60 * 60 * 1000);
 
      // Update milestone
      const milestones = ['10k', '50k', '100k', '500k', '1jt'];
      const milestoneUpdates = {};
      for (const milestone of milestones) {
        const milestoneAmount = parseInt(
          milestone.replace('k', '000').replace('jt', '000000')
        );
        if (nominalInput >= milestoneAmount) {
          milestoneUpdates[`donationMilestones.${milestone}`] = true;
        }
      }
 
      await Donation.findByIdAndUpdate(
        dataDonasi._id,
        { $set: { availableAt, isAvailable: false, streamerReceive } },
        { session }
      );
 
      await User.findByIdAndUpdate(
        streamer._id,
        {
          $inc: {
            walletBalance:      streamerReceive,
            totalDonations:     nominalInput,
            totalDonationCount: 1,
          },
          $set: milestoneUpdates,
        },
        { session }
      );
 
      await session.commitTransaction();
      committed = true;
      session.endSession();
 
      // ── Post-commit: poll, subathon, overlay ──────────────────────────────
 
      // Poll
      if (dataDonasi.pollVote?.pollId && dataDonasi.pollVote?.optionId) {
        try {
          const poll = await Poll.findOne({ _id: dataDonasi.pollVote.pollId, status: 'active' });
          if (poll) {
            const option = poll.options.id(dataDonasi.pollVote.optionId);
            if (option) {
              option.votes += 1;
              await poll.save();
              const io = req.app.get('socketio');
              if (io && streamer?.overlayToken) {
                io.to(streamer.overlayToken).emit('poll-updated', poll);
              }
            }
          }
        } catch (pollErr) {
          console.error('[Doku Webhook] Poll error:', pollErr.message);
        }
      }
 
      // Subathon
      try {
        const subathonResult = await subathonCtrl.handleDonationPaid(req, streamer._id, nominalInput);
        if (subathonResult) {
          const io = req.app.get('socketio');
          if (io && streamer?.overlayToken) {
            io.to(streamer.overlayToken).emit('subathon-updated', subathonResult.timer || subathonResult);
          }
        }
      } catch (subErr) {
        console.error('[Doku Webhook] Subathon error:', subErr.message);
      }
 
      // Overlay / socket
      const io = req.app.get('socketio');
      if (io && streamer.overlayToken) {
        const overlaySetting  = await OverlaySetting.findOne({ userId: streamer._id });
        const soundUrl        = overlaySetting?.getSoundForAmount
          ? overlaySetting.getSoundForAmount(nominalInput)
          : (overlaySetting?.soundUrl || null);
        const displayDuration = getDisplayDuration(nominalInput, overlaySetting);
 
        if (dataDonasi.voiceUrl) {
          io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', {
            donorName:  dataDonasi.donorName,
            amount:     nominalInput,
            message:    dataDonasi.message,
            voiceUrl:   dataDonasi.voiceUrl,
            soundUrl:   null,
            receivedAt: new Date().toISOString(),
          });
        }
 
        const payload = {
          donorName:    dataDonasi.donorName,
          amount:       nominalInput,
          message:      dataDonasi.message,
          voiceUrl:     dataDonasi.voiceUrl    || null,
          mediaUrl:     dataDonasi.mediaUrl    || null,
          mediaType:    dataDonasi.mediaType   || null,
          isMediaShare: dataDonasi.isMediaShare || !!dataDonasi.mediaUrl,
          startTime:    dataDonasi.startTime   || 0,
          soundUrl:     dataDonasi.soundUrl    || soundUrl,
          videoBlocked: dataDonasi.videoBlocked || false,
          blockReason:  dataDonasi.blockReason  || null,
          receivedAt:   new Date().toISOString(),
        };
 
        donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);
        console.log(`[Doku Webhook] ✅ Donasi "${dataDonasi.donorName}" masuk antrian @${streamer.username}`);
      }
 
    } catch (err) {
      if (!committed) {
        try { await session.abortTransaction(); } catch {}
        session.endSession();
      }
      console.error('[Doku Webhook] Error:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
 
    console.log('========== [DOKU WEBHOOK SELESAI] ==========\n');
    return res.status(200).json({ message: 'OK' });
 
  } catch (err) {
    console.error('[Doku Webhook] Outer error:', err);
    return res.status(500).json({ message: err.message });
  }
};
 
// ─────────────────────────────────────────────────────────────────────────────
// BINDING URL
// Doku hit endpoint ini saat merchant pertama kali didaftarkan / reverifikasi.
// Harus return 200 + echo token yang dikirim Doku.
// ─────────────────────────────────────────────────────────────────────────────
exports.handleBinding = (req, res) => {
  console.log('\n========== [DOKU BINDING] ==========');
  console.log('Body   :', JSON.stringify(req.body,    null, 2));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  // Doku mengirim token verifikasi, kita wajib echo balik
  const token = req.body?.token || req.query?.token || '';

  return res.status(200).json({
    token,         // echo token dari Doku
    status: 'OK',
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE NOTIFY URL (QRIS)
// Digunakan untuk mendaftarkan/update Notify URL ke Doku untuk channel QRIS
// ─────────────────────────────────────────────────────────────────────────────
exports.updateQrisNotifyUrl = async (req, res) => {
  console.log('\n========== [DOKU UPDATE QRIS NOTIFY URL] ==========');

  try {
    const notifyUrl = `https://server-ttt-production.up.railway.app/api/doku-payment/webhook`;

    const payload = {
      notify_url: notifyUrl,
    };

    const dokuRes = await dokuRequest('POST', '/qris/v1/notify-url', payload);

    console.log('[Doku QRIS] Notify URL updated:', dokuRes);
    return res.status(200).json({
      message: 'Notify URL berhasil diupdate',
      notify_url: notifyUrl,
      doku_response: dokuRes,
    });

  } catch (err) {
    console.error('[Doku QRIS] Update Notify URL error:', err.message);
    return res.status(500).json({ message: 'Gagal update Notify URL', details: err.message });
  }
};