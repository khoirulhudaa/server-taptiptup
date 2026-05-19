  // controllers/midtransController.js
  const midtransClient = require('midtrans-client');
  const crypto = require('crypto');
  const mongoose = require('mongoose');
  const { Donation, Withdrawal, User, OverlaySetting, Poll } = require('../models');
  const { filterMessage } = require('./bannedWordController');
  const subathonCtrl = require('./subathonController');
  const { donationQueue } = require('../utils/donationQueue');
  const { sendWithdrawalNotification } = require('../utils/telegramNotification');
  require('dotenv').config();

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

  const snap = new midtransClient.Snap({
    isProduction,
    serverKey: SERVER_KEY,
    clientKey: CLIENT_KEY,
  });

  const verifyMidtransSignature = (orderId, statusCode, grossAmount, signatureKey) => {
    const hash = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
      .digest('hex');
    return hash === signatureKey;
  };

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
  
  exports.createDonation = async (req, res) => {
    const {
      amount, donorName, message, userId, email,
      mediaUrl, mediaType, donorUserId, soundUrl,
      pollVote, voiceUrl
    } = req.body;

    if (!amount || !userId) {
      return res.status(400).json({ message: 'Amount dan userId wajib diisi' });
    }

    const nominal = Math.round(Number(amount)); // Nominal yang diinput donor
    const orderId = `donasi-${userId}-${Date.now()}`;

    try {
      const streamer = await User.findById(userId);
      const overlaySetting = await OverlaySetting.findOne({ userId }) || {};
      const feeBearer = overlaySetting.feeBearer || 'streamer'; // default streamer

      const percentFee = Math.round(nominal * 0.025); // 2.5%

      let grossAmount;        // Yang dibayar donor ke Midtrans
      let streamerWillReceive; // Yang streamer dapat

      if (feeBearer === 'donor') {
        grossAmount = nominal + percentFee;        // Donor bayar lebih
        streamerWillReceive = nominal;
      } else {
        grossAmount = nominal;
        streamerWillReceive = nominal - percentFee; // Streamer tanggung 2.5%
      }

      const streamerUsername = streamer?.username || userId;

      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: grossAmount,
        },
        customer_details: {
          first_name: donorName || 'Anonim',
          email: email || 'guest@mail.com',
        },
        item_details: [{
          id: 'DONASI',
          price: grossAmount,
          quantity: 1,
          name: `Donasi untuk @${streamerUsername}`,
        }],
        callbacks: {
          finish:  `${BASE_URL}/donation/success?username=${streamerUsername}`,
          error:   `${BASE_URL}/donation/failed?username=${streamerUsername}`,
          pending: `${BASE_URL}/donation/pending?username=${streamerUsername}`,
        },
      };

      const snapResponse = await snap.createTransaction(parameter);

      const { blocked, filtered } = await filterMessage(userId, message);
      if (blocked) {
        return res.status(400).json({ message: 'Pesan mengandung kata terlarang.' });
      }
  
      // Validasi pollVote jika ada
      let validatedPollVote = null;
      if (pollVote?.pollId && pollVote?.optionId) {
        const poll = await Poll.findOne({ _id: pollVote.pollId, status: 'active' }).lean();
        if (poll) {
          const optionExists = poll.options.some(o => String(o._id) === String(pollVote.optionId));
          if (optionExists) {
            validatedPollVote = {
              pollId:   pollVote.pollId,
              optionId: String(pollVote.optionId),
            };
          }
        }
      }
  
      await Donation.create({
        externalId:  orderId,
        userId,
        donorUserId: donorUserId || null,
        // amount:      Math.round(Number(amount)),
        donorName:   donorName || 'Anonim',
        message:     filtered || '',
        amount: nominal,                    // nominal input donor
        grossAmount,
        voiceUrl: voiceUrl || null,  // ← TAMBAH INI
        paymentUrl:  snapResponse.redirect_url,
        status:      'PENDING',
        streamerReceive: streamerWillReceive,  // ← TAMBAH INI
        feeBearer,                             // ← TAMBAH INI
        percentFee:      percentFee, 
        mediaUrl:    mediaUrl || null,
        mediaType:   mediaType || null,
        startTime: req.body.startTime || 0,  
        soundUrl: soundUrl || null, // ← SAVE soundUrl
        pollVote:    validatedPollVote,
      });
  
      res.json({ url: snapResponse.redirect_url, token: snapResponse.token });
    } catch (err) {
      console.error('[Midtrans Error]:', err);
      res.status(500).json({ message: 'Midtrans Error', details: err?.ApiResponse || err.message });
    }
  };

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
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // 1. Update donation status → PAID
        const dataDonasi = await Donation.findOneAndUpdate(
          { externalId: order_id, status: 'PENDING' },
          { $set: { status: 'PAID' } },
          { new: true, session }
        ).populate('userId');

        if (!dataDonasi) {
          console.log(`[Webhook] Duplikat/tidak ditemukan: ${order_id} — skip`);
          await session.commitTransaction();
          return res.status(200).json({ message: 'OK' });
        }

        const streamer = dataDonasi.userId;
        if (!streamer) {
          console.warn('[Webhook] Streamer tidak ditemukan');
          await session.commitTransaction();
          return res.status(200).json({ message: 'OK' });
        }

        const nominalInput = parseFloat(dataDonasi.amount);
        const streamerReceive = parseFloat(dataDonasi.streamerReceive || dataDonasi.amount);

        console.log(`[FEE WEBHOOK] Nominal Input: Rp${nominalInput} | Streamer Terima: Rp${streamerReceive}`);

        // 2. Update wallet -Langsung 增加 tapi dgn availableAt = 1 hari kemudian
        const availableAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24 jam

        const milestones = ['10k', '50k', '100k', '500k', '1jt'];
        const milestoneUpdates = {};
        for (const milestone of milestones) {
          const milestoneAmount = parseInt(milestone.replace('k', '000').replace('jt', '000000'));
          if (nominalInput >= milestoneAmount) {
            milestoneUpdates[`donationMilestones.${milestone}`] = true;
          }
        }

        // Update donation dgn availableAt
        await Donation.findByIdAndUpdate(
          dataDonasi._id,
          {
            $set: {
              availableAt: availableAt,
              isAvailable: false
            }
          },
          { session }
        );

        // Tandai donasi belum available, set kapan bisa available
        await Donation.findByIdAndUpdate(
          dataDonasi._id,
          {
            $set: {
              availableAt:  availableAt,
              isAvailable:  false,          // belum bisa ditarik
              streamerReceive: streamerReceive, // simpan untuk cron pakai ini
            }
          },
          { session }
        );

        await User.findByIdAndUpdate(
          streamer._id,
          {
            $inc: {
              walletBalance:      streamerReceive,  // total saldo (termasuk yang pending)
              totalDonations:     nominalInput,
              totalDonationCount: 1,
              // ❌ JANGAN tambahkan availableBalance di sini
            },
            $set: milestoneUpdates,
          },
          { session }
        );

        console.log(`[Webhook] Wallet @${streamer.username} +Rp${streamerReceive} (belum available, perlu tunggu 1 hari)`);

        await session.commitTransaction();
        session.endSession();

        if (dataDonasi.pollVote?.pollId && dataDonasi.pollVote?.optionId) {
          try {
            const poll = await Poll.findOne({ _id: dataDonasi.pollVote.pollId, status: 'active' });
            if (poll) {
              const option = poll.options.id(dataDonasi.pollVote.optionId);
              if (option) {
                option.votes += 1;
                await poll.save();
                const io = req.app.get('socketio');
                if (io && streamer?.overlayToken) io.to(streamer.overlayToken).emit('poll-updated', poll);
              }
            }
          } catch (pollErr) { console.error('[Webhook] Poll vote error:', pollErr.message); }
        }

        // ─── Subathon ─────────────────────────────────────────────────────────────
        try {
          const subathonResult = await subathonCtrl.handleDonationPaid(req, streamer._id, nominalInput);
          if (subathonResult) {
            const io = req.app.get('socketio');
            if (io && streamer?.overlayToken) io.to(streamer.overlayToken).emit('subathon-updated', subathonResult.timer || subathonResult);
          }
        } catch (subErr) { console.error('[Webhook] Subathon error:', subErr.message); }

        // ─── Overlay Queue + Voice Emit ───────────────────────────────────────────
        const io = req.app.get('socketio');   // ← satu kali saja di sini

        if (io && streamer.overlayToken) {
          const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
          const soundUrl = overlaySetting?.getSoundForAmount
            ? overlaySetting.getSoundForAmount(nominalInput)
            : (overlaySetting?.soundUrl || null);
          const displayDuration = getDisplayDuration(nominalInput, overlaySetting);

          // ─── Voice Note Overlay (room terpisah, SEKALI saja) ───────────────
          if (dataDonasi.voiceUrl) {
            io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', {
              donorName:  dataDonasi.donorName,
              amount:     nominalInput,
              message:    dataDonasi.message,
              voiceUrl:   dataDonasi.voiceUrl,   // ← URL rekaman donor
              soundUrl:   null,                  // ← jangan pakai sound overlay di voice tab
              receivedAt: new Date().toISOString(),
            });
            console.log(`[VoiceOverlay] Emitted ke room ${streamer.overlayToken}-voice`);
          }

          // ─── Alert/Media Share Overlay biasa ───────────────────────────────
          const payload = {
            donorName:    dataDonasi.donorName,
            amount:       nominalInput,
            message:      dataDonasi.message,
            voiceUrl:     dataDonasi.voiceUrl || null,
            mediaUrl:     dataDonasi.mediaUrl || null,
            mediaType:    dataDonasi.mediaType || null,
            startTime:    dataDonasi.startTime || 0,
            soundUrl:     dataDonasi.soundUrl || soundUrl,  // prioritas: pilihan donor > default overlay
            receivedAt:   new Date().toISOString(),
            isMediaShare: !!dataDonasi.mediaUrl,
            queuePosition: donationQueue.getQueueLength(streamer.overlayToken) + 1,
          };
          donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);
          console.log(`[Webhook] Donasi "${dataDonasi.donorName}" masuk antrian overlay @${streamer.username}`);
        }

      } catch (err) {
        await session.abortTransaction();
        session.endSession();
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

  exports.checkAvailableBalance = async (req, res) => {
  try {
    // Cari semua donasi PAID yang sudah melewati 1 hari tapi belum diupdate
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pendingDonations = await Donation.find({
      status: 'PAID',
      isAvailable: false,
      availableAt: { $lte: new Date() }  // Jika availableAt <= sekarang
    }).populate('userId');

    console.log(`[CheckAvailableBalance] Menemukan ${pendingDonations.length} donasi yang akan tersedia`);

    for (const donation of pendingDonations) {
      const streamer = donation.userId;
      if (!streamer) continue;

      const receiveAmount = parseFloat(donation.streamerReceive || donation.amount);
      
      // Update availableBalance streamer
      await User.findByIdAndUpdate(
        streamer._id,
        { $inc: { availableBalance: receiveAmount } }
      );

      // Tandai donasi sudah available
      await Donation.findByIdAndUpdate(
        donation._id,
        { $set: { isAvailable: true } }
      );

      console.log(`[AvailableBalance] @${streamer.username} +Rp${receiveAmount} menjadi available`);
    }

    res.json({ 
      message: `Berhasil update ${pendingDonations.length} donasi`,
      count: pendingDonations.length
    });
  } catch (err) {
    console.error('[CheckAvailableBalance] Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Endpoint buat user cek sendiri
exports.getAvailableBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    //强制刷新availableBalance dari donasi yang sudah expired 1 hari
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Get sum of available donations
    const availableDonations = await Donation.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: 'PAID',
          isAvailable: true
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$streamerReceive' }
        }
      }
    ]);

    const computedAvailable = availableDonations[0]?.total || 0;

    res.json({
      walletBalance: user.walletBalance,
      availableBalance: computedAvailable,  // Pakai yang dihitung ulang
      pendingBalance: user.walletBalance - computedAvailable
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

  exports.requestWithdrawal = async (req, res) => {
    const { amount, paymentMethod, channelCode, accountNumber, accountName } = req.body;
    const userId = req.user.id;
  
    const amt = parseFloat(amount);
  
    if (!amount || isNaN(amt) || amt <= 0)
      return res.status(400).json({ message: 'Nominal tidak valid' });
    if (amt < 20000)
      return res.status(400).json({ message: 'Minimal penarikan adalah Rp 20.000' });
    if (amt > 10000000)
      return res.status(400).json({ message: 'Maksimal penarikan adalah Rp 10.000.000' });
    if (!channelCode || !accountNumber || !accountName)
      return res.status(400).json({ message: 'Data rekening tidak lengkap' });
  
    const referenceNo = `wd-${userId}-${Date.now()}`;
    const session     = await mongoose.startSession();
    session.startTransaction();
  
    try {
      // 1. Ambil availableBalance user saat ini
      const user = await User.findById(userId).session(session);
      const availableBalance = parseFloat(user?.availableBalance || 0);
  
      if (availableBalance < 20000) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Saldo tersedia minimal Rp 20.000. Saldo tersedia: Rp ${availableBalance.toLocaleString('id-ID')}`,
        });
      }
  
      if (amt > availableBalance) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: `Saldo tidak cukup. Saldo tersedia: Rp ${availableBalance.toLocaleString('id-ID')}`,
        });
      }
  
      // 2. Potong availableBalance dan walletBalance (keduanya harus berkurang)
      // Tidak ada fee tambahan — 2.5% sudah dipotong saat donasi masuk
      await User.findOneAndUpdate(
        { _id: userId, availableBalance: { $gte: amt } },
        {
          $inc: {
            availableBalance: -amt,
            walletBalance:    -amt,
          }
        },
        { new: true, session }
      );
  
      // 3. Buat record withdrawal
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

      await sendWithdrawalNotification({
        username: user.username,
        amount: amt,
        paymentMethod: paymentMethod || 'BANK',
        channelCode,
        accountNumber,
        accountName,
      });
  
      res.json({
        message: '✅ Penarikan berhasil diajukan!',
        referenceNo,
        status: 'PENDING',
        detail: `Rp ${amt.toLocaleString('id-ID')} → ${channelCode} ${accountNumber}`,
      });
  
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
      console.error('[requestWithdrawal] Error:', err);
      res.status(500).json({ message: 'Terjadi kesalahan', error: err.message });
    }
  };

  // ============================================================
  // GET WITHDRAWAL HISTORY
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
  // [ADMIN] APPROVE / REJECT WITHDRAWAL
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

      withdrawal.status = status;
      withdrawal.note = note || null;
      await withdrawal.save({ session });

      const streamer = withdrawal.userId;
      const io = req.app.get('socketio');

      if (status === 'COMPLETED') {
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
        const refundAmount = parseFloat(withdrawal.amount) + 0;

        if (streamer) {
          await User.findByIdAndUpdate(
            streamer._id,
            { $inc: { walletBalance: refundAmount } },
            { session }
          );
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

  // ============================================================
  // GHOST ALERT (SuperAdmin)
  // ============================================================
  exports.sendGhostAlert = async (req, res) => {
    const { targetUserId, donorName, amount, message, mediaUrl, mediaType, voiceUrl } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ message: 'targetUserId wajib diisi' });
    }
    if (!amount || Number(amount) < 1000) {
      return res.status(400).json({ message: 'Nominal minimal Rp 1.000' });
    }

    try {
      const streamer = await User.findById(targetUserId).lean();
      if (!streamer) {
        return res.status(404).json({ message: 'Streamer tidak ditemukan' });
      }
      if (!streamer.overlayToken) {
        return res.status(400).json({ message: 'Streamer belum memiliki overlay token' });
      }

      const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
      const displayDuration = getDisplayDuration(Number(amount), overlaySetting);
      const soundUrl = overlaySetting?.getSoundForAmount
        ? overlaySetting.getSoundForAmount(Number(amount))
        : (overlaySetting?.soundUrl || null);

      const io = req.app.get('socketio');
      if (!io) {
        return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
      }

      const payload = {
        donorName: donorName || 'SuperAdmin 👑',
        amount: Number(amount),
        message: message || '',
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        voiceUrl: voiceUrl || null,           // ← TAMBAH INI
        receivedAt: new Date().toISOString(),
        soundUrl,
        isGhostAlert: true,
      };

      // Gunakan queue (akan emit new-donation + new-media-donation kalau ada media)
      donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);

      console.log(`[GhostAlert] @${req.user?.username} → @${streamer.username} | Rp${amount} | media: ${mediaUrl || 'none'}`);

      return res.json({
        message: `Ghost alert berhasil dikirim ke @${streamer.username}`,
        target: streamer.username,
        amount: Number(amount),
        displayDuration,
      });
    } catch (err) {
      console.error('[sendGhostAlert] Error:', err);
      return res.status(500).json({ message: 'Server error', error: err.message });
    }
  };

  exports.getAllUsers = async (req, res) => {
    try {
      const { search, limit = 100, page = 1 } = req.query;

      const query = { role: { $ne: 'superAdmin' } };

      if (search) {
        query.$or = [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      const skip = (page - 1) * Number(limit);

      const users = await User.find(query)
        .select('username email role walletBalance overlayToken createdAt')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(skip)
        .lean();

      const total = await User.countDocuments(query);

      res.json({
        success: true,
        users,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error('Get All Users Error:', err);
      res.status(500).json({ success: false, message: 'Gagal mengambil daftar user' });
    }
  };

  exports.getUserBadges = async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId).select('donationMilestones donorMilestones');
      
      res.json({
        badges: {
          streamer: user.donationMilestones || {},
          donor: user.donorMilestones || {}
        }
      });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch badges' });
    }
  };