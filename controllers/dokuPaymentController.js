// controllers/dokuPaymentController.js
const mongoose = require('mongoose');
const { Donation, User, OverlaySetting, Poll } = require('../models');
const { dokuRequest } = require('../utils/doku');
const { filterMessage } = require('./bannedWordController');
const subathonCtrl = require('./subathonController');
const { donationQueue } = require('../utils/donationQueue');
const { checkYouTubeVideo } = require('../utils/checkYoutube');

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
        line_items: [{
          name: `Donasi untuk @${streamer.username}`,
          price: grossAmount,
          quantity: 1,
        }],
        amount: grossAmount,
        currency: 'IDR',
        callback_url: `${BASE_URL}/donation/success?username=${streamer.username}`,
        callback_url_cancel: `${BASE_URL}/donation/failed?username=${streamer.username}`,
        auto_redirect: false,
        session_id: orderId,
        request_expired_time: expiredTime, // ← untuk notifikasi expired
        disable_retry_payment: false,
      },
      payment: {
        payment_due_date: 60, // menit
      },
      customer: {
        name: donorName || 'Anonim',
        email: email || 'guest@mail.com',
      },
    };

    const dokuRes = await dokuRequest('POST', '/payment-checkout/v1/payment', dokuPayload);

    if (!dokuRes?.response?.payment_url) {
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
      url: dokuRes.response.payment_url,
      invoiceNumber: orderId,
    });

  } catch (err) {
    console.error('[Doku Payment] Error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'Gagal membuat invoice', details: err.message });
  }
};

// ── POST /api/doku-payment/webhook ────────────────────────────────────────────
// Doku mengirim notifikasi ke sini untuk: SUCCESS, FAILED, EXPIRED
exports.handleWebhook = async (req, res) => {
  console.log('\n========== [DOKU PAYMENT WEBHOOK] ==========');
  console.log('Body:', JSON.stringify(req.body, null, 2));

  try {
    const { order, transaction } = req.body;
    const invoiceNumber = order?.invoice_number;
    const dokuStatus = transaction?.status;   // SUCCESS | FAILED | EXPIRED

    if (!invoiceNumber || !dokuStatus) {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    // ── EXPIRED ───────────────────────────────────────────────────────────────
    if (dokuStatus === 'EXPIRED') {
      await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'EXPIRED' } }
      );
      console.log(`[Doku Webhook] Donasi ${invoiceNumber} => EXPIRED`);
      return res.status(200).json({ message: 'OK' });
    }

    // ── FAILED ────────────────────────────────────────────────────────────────
    if (dokuStatus === 'FAILED') {
      await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'FAILED' } }
      );
      console.log(`[Doku Webhook] Donasi ${invoiceNumber} => FAILED`);
      return res.status(200).json({ message: 'OK' });
    }

    // ── SUCCESS ───────────────────────────────────────────────────────────────
    if (dokuStatus !== 'SUCCESS') {
      return res.status(200).json({ message: 'Status ignored' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    let committed = false;

    try {
      const dataDonasi = await Donation.findOneAndUpdate(
        { externalId: invoiceNumber, status: 'PENDING' },
        { $set: { status: 'PAID' } },
        { new: true, session }
      ).populate('userId');

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
        const milestoneAmount = parseInt(milestone.replace('k', '000').replace('jt', '000000'));
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

      // ── Post-commit: poll, subathon, overlay ─────────────────────────────
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
        const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
        const soundUrl = overlaySetting?.getSoundForAmount
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
          voiceUrl:     dataDonasi.voiceUrl   || null,
          mediaUrl:     dataDonasi.mediaUrl   || null,
          mediaType:    dataDonasi.mediaType  || null,
          isMediaShare: dataDonasi.isMediaShare || !!dataDonasi.mediaUrl,
          startTime:    dataDonasi.startTime  || 0,
          soundUrl:     dataDonasi.soundUrl   || soundUrl,
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