
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Donation, Withdrawal, User, OverlaySetting, Poll, AuditLog, IpBlacklist } = require('../models');
const { filterMessage } = require('./bannedWordController');
const subathonCtrl = require('./subathonController');
const { donationQueue } = require('../utils/donationQueue');
const { sendWithdrawalNotification } = require('../utils/telegramNotification');
const { checkYouTubeVideo } = require('../utils/checkYoutube');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();
const rateLimit = require('express-rate-limit');

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

const toYouTubeEmbed = (url, startTime = 0) => {
  if (!url || !isYouTubeUrl(url)) return url;

  let videoId = '';
  if (url.includes('youtu.be')) {
    videoId = url.split('youtu.be/')[1]?.split(/[?&]/)[0];
  } else {
    try {
      const urlObj = new URL(url);
      videoId = urlObj.searchParams.get('v') || '';
      if (!videoId) {
        const pathMatch = url.match(/youtube\.com\/(live|shorts)\/([\w-]+)/);
        if (pathMatch) videoId = pathMatch[2];
      }
    } catch { /* fallback */ }
  }

  if (!videoId) return url;

  const isLive = /youtube\.com\/live\//i.test(url); 
  let embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&controls=0`;
  if (!isLive) embedUrl += `&loop=1&playlist=${videoId}`;
  if (!isLive && startTime > 0) embedUrl += `&start=${Math.floor(startTime)}`; 
  return embedUrl;
};

const isYouTubeUrl = (url) => {
  if (!url) return false;
  return (
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    url.includes('youtube-nocookie.com')
  );
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
    pollVote, voiceUrl, isMediaShare, donationItem,
    songData, donorGifChoice
  } = req.body;

  if (!amount || !userId) {
    return res.status(400).json({ message: 'Amount dan userId wajib diisi' });
  }

  const donorIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.ip ||
    null;
 
  
  if (donorIp) {
    const blocked = await IpBlacklist.findOne({ userId, ip: donorIp });
    if (blocked) {
      return res.status(403).json({
        message: 'IP_BLOCKED',
        detail: 'Kamu tidak dapat mengirim dukungan ke streamer ini.',
      });
    }
  }

  const nominal = Math.round(Number(amount)); 
  
  const orderId = `donasi-${userId}-${Date.now()}`;

  try {
    const streamer = await User.findById(userId);
    const overlaySetting = await OverlaySetting.findOne({ userId }) || {};
    const feeBearer = overlaySetting.feeBearer || 'streamer'; 

    const percentFee = Math.round(nominal * 0.030); 

    let grossAmount;        
    let streamerWillReceive; 

    if (feeBearer === 'donor') {
      grossAmount = nominal + percentFee;        
      streamerWillReceive = nominal;
    } else {
      grossAmount = nominal;
      streamerWillReceive = nominal - percentFee; 
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

    let videoBlocked = false;
    let blockReason = null;

    const isLiveUrl = /youtube\.com\/live\//i.test(mediaUrl);
    if (mediaUrl && isYouTubeUrl(mediaUrl) && !isLiveUrl) {
      try {
        const ytCheck = await checkYouTubeVideo(mediaUrl);
        if (!ytCheck.safe) {
          videoBlocked = true;
          blockReason = ytCheck.reason;
          console.log(`[YT Check] ⛔ Blocked: ${blockReason}`);
        } else {
          console.log(`[YT Check] ✅ "${ytCheck.title}" — aman`);
        }
      } catch (err) {
        console.warn('[YT Check] ⚠️ Check gagal, video diloloskan:', err.message);
      }
    }

    
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

    
    if (songData) {
      if (!overlaySetting.songRequestEnabled) {
        return res.status(400).json({ message: 'Streamer belum mengaktifkan fitur Song Request' });
      }
      const minSong = overlaySetting.songRequestMinAmount || 25000;
      if (nominal < minSong) {
        return res.status(400).json({ message: `Song Request butuh minimal Rp ${minSong.toLocaleString('id-ID')}` });
      }
    }

    await Donation.create({
      externalId:  orderId,
      userId,
      donorUserId: donorUserId || null,
      donorGifChoice: donorGifChoice || null,
      
      donorName:   donorName || 'Anonim',
      message:     filtered || '',
      isMediaShare: isMediaShare || false,  
      amount: nominal,                    
      grossAmount,
      songData: songData || null,
      videoBlocked,       
      blockReason,        
      voiceUrl: voiceUrl || null,  
      paymentUrl:  snapResponse.redirect_url,
      donationItem: donationItem || null,   
      status:      'PENDING',
      streamerReceive: streamerWillReceive,  
      feeBearer,                             
      percentFee:      percentFee, 
      mediaUrl:    mediaUrl || null,
      mediaType:   mediaType || null,
      startTime: req.body.startTime || 0,  
      soundUrl: soundUrl || null, 
      pollVote:    validatedPollVote,
      donorIp
    });

    res.json({ url: snapResponse.redirect_url, token: snapResponse.token, orderId });
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

    const isSuccess = transaction_status === 'settlement' ||
                     (transaction_status === 'capture' && fraud_status === 'accept');

    if (isSuccess) {
      const session = await mongoose.startSession();
      session.startTransaction();
      let committed = false;

      try {
        const dataDonasi = await Donation.findOneAndUpdate(
          { externalId: order_id, status: 'PENDING' },
          { $set: { status: 'PAID' } },
          { new: true, session }
        ).populate('userId');

        if (!dataDonasi) {
          console.log(`[Webhook] Duplikat/tidak ditemukan: ${order_id} — skip`);
          await session.commitTransaction();
          committed = true;
          session.endSession();
          return res.status(200).json({ message: 'OK' });
        }

        const streamer = dataDonasi.userId;
        if (!streamer) {
          console.warn('[Webhook] Streamer tidak ditemukan');
          await session.commitTransaction();
          committed = true;
          session.endSession();
          return res.status(200).json({ message: 'OK' });
        }

        const nominalInput    = parseFloat(dataDonasi.amount);
        const streamerReceive = parseFloat(dataDonasi.streamerReceive || dataDonasi.amount);

        console.log(`[FEE WEBHOOK] Nominal Input: Rp${nominalInput} | Streamer Terima: Rp${streamerReceive}`);

        const availableAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

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
            $inc: { walletBalance: streamerReceive, totalDonations: nominalInput, totalDonationCount: 1 },
            $set: milestoneUpdates,
          },
          { session }
        );

        console.log(`[Webhook] Wallet @${streamer.username} +Rp${streamerReceive}`);

        await session.commitTransaction();
        committed = true;
        session.endSession();

        
        const io = req.app.get('socketio');
        if (io && streamer?.overlayToken) {
          const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });
          const soundUrl = overlaySetting?.getSoundForAmount
            ? overlaySetting.getSoundForAmount(nominalInput)
            : (overlaySetting?.soundUrl || null);

          const basePayload = {
            donorName:    dataDonasi.donorName,
            amount:       nominalInput,
            message:      dataDonasi.message || '',
            receivedAt:   new Date().toISOString(),
            soundUrl:     dataDonasi.soundUrl || soundUrl,
            donationItem: dataDonasi.donationItem || null,
            donorGifChoice: dataDonasi.donorGifChoice || null,  
          };

          const displayDuration = getDisplayDuration(nominalInput, overlaySetting);

          
          if (dataDonasi.songData?.videoId) {
            
            const songDuration = (dataDonasi.songData.duration || 180) * 1000; 
            const payload = {
              ...basePayload,
              songData: dataDonasi.songData,
              isSongRequest: true,
            };
            donationQueue.enqueue(streamer.overlayToken, payload, io, songDuration);
          }
          
          else if (dataDonasi.voiceUrl && !dataDonasi.mediaUrl) {
            
            
            
            
            const payload = { ...basePayload, voiceUrl: dataDonasi.voiceUrl };
            donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);
          } 
          
          else if (dataDonasi.mediaUrl && dataDonasi.isMediaShare) {
            const mediaPayload = {
              ...basePayload,
              mediaUrl: dataDonasi.mediaUrl,
              mediaType: dataDonasi.mediaType || 'image',
              startTime: dataDonasi.startTime || 0,
              isMediaShare: true,
              videoBlocked: dataDonasi.videoBlocked || false,
              blockReason: dataDonasi.blockReason || null,
            };
            donationQueue.enqueue(streamer.overlayToken, mediaPayload, io, displayDuration);
          }
          
          else {
            
            donationQueue.enqueue(streamer.overlayToken, basePayload, io, displayDuration);
          }
        }

        
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
            console.error('[Webhook] Poll vote error:', pollErr.message);
          }
        }

        try {
          const subathonResult = await subathonCtrl.handleDonationPaid(req, streamer._id, nominalInput);
          if (subathonResult) {
            const io = req.app.get('socketio');
            if (io && streamer?.overlayToken) {
              io.to(streamer.overlayToken).emit('subathon-updated', subathonResult.timer || subathonResult);
            }
          }
        } catch (subErr) {
          console.error('[Webhook] Subathon error:', subErr.message);
        }

      } catch (err) {
        if (!committed) {
          try { await session.abortTransaction(); } catch (e) {}
          session.endSession();
        }
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
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pendingDonations = await Donation.find({
      status: 'PAID',
      isAvailable: false,
      availableAt: { $lte: new Date() }  
    }).populate('userId');

    console.log(`[CheckAvailableBalance] Menemukan ${pendingDonations.length} donasi yang akan tersedia`);

    for (const donation of pendingDonations) {
      const streamer = donation.userId;
      if (!streamer) continue;

      const receiveAmount = parseFloat(donation.streamerReceive || donation.amount);
      
      
      await User.findByIdAndUpdate(
        streamer._id,
        { $inc: { availableBalance: receiveAmount } }
      );

      
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


exports.getAvailableBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    //availableBalance dari donasi yang sudah expired 1 hari
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    
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
      availableBalance: computedAvailable,  
      pendingBalance: user.walletBalance - computedAvailable
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

 
exports.withdrawRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 3,                    
  keyGenerator: (req) => req.user?.id || req.ip, 
  message: { message: 'Terlalu banyak permintaan penarikan. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const createAuditLog = async (userId, action, details, session = null) => {
  const log = {
    userId,
    action,
    details,
    ip: details.ip || 'unknown',
    timestamp: new Date(),
  };
  
  const options = session ? { session } : {};
  await AuditLog.create([log], options);
};

exports.requestWithdrawal = async (req, res) => {
  const {
    amount,
    paymentMethod,
    channelCode,
    accountNumber,
    accountName,
    totpCode,
    idempotencyKey, 
  } = req.body;

  const userId = req.user.id;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 16) {
    return res.status(400).json({ message: 'Idempotency key tidak valid' });
  }

  
  const existingRequest = await Withdrawal.findOne({ idempotencyKey });
  if (existingRequest) {
    return res.status(409).json({
      message: 'Request ini sudah pernah diproses sebelumnya.',
      status: existingRequest.status,
      referenceNo: existingRequest.midtransReference,
    });
  }

  
  if (!totpCode || !/^\d{6}$/.test(totpCode)) {
    return res.status(400).json({ message: 'Kode Google Authenticator harus 6 digit angka' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    
    
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Google Authenticator belum diaktifkan.' });
    }

    
    const isValidTotp = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: totpCode,
      window: 0, 
    });

    if (!isValidTotp) {
      await session.abortTransaction();
      session.endSession();

      
      await createAuditLog(userId, 'WITHDRAW_TOTP_FAILED', {
        ip: clientIp,
        amount,
        channelCode,
        accountNumber,
      });

      return res.status(401).json({ message: 'Kode Google Authenticator salah atau sudah kadaluarsa' });
    }

    
    const MAX_DAILY = 10000000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayWithdrawals = await Withdrawal.aggregate([
      {
        $match: {
          userId: user._id,
          status: { $in: ['PENDING', 'COMPLETED'] },
          createdAt: { $gte: startOfDay },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).session(session);

    const todayTotal = todayWithdrawals[0]?.total || 0;
    const grossAmount = parseFloat(amount);

    if (todayTotal + grossAmount > MAX_DAILY) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Batas penarikan harian Rp ${MAX_DAILY.toLocaleString('id-ID')} terlampaui. Sudah ditarik hari ini: Rp ${todayTotal.toLocaleString('id-ID')}`,
      });
    }

    
    const WITHDRAW_FEE = 4000;
    const MIN_WITHDRAW = 20000;
    const MAX_WITHDRAW = 10000000;

    if (!grossAmount || isNaN(grossAmount) || grossAmount <= 0)
      return res.status(400).json({ message: 'Nominal tidak valid' });
    if (grossAmount < MIN_WITHDRAW)
      return res.status(400).json({ message: `Minimal penarikan Rp ${MIN_WITHDRAW.toLocaleString('id-ID')}` });
    if (grossAmount > MAX_WITHDRAW)
      return res.status(400).json({ message: `Maksimal penarikan Rp ${MAX_WITHDRAW.toLocaleString('id-ID')}` });

    const netAmount = grossAmount - WITHDRAW_FEE;
    if (netAmount <= 0)
      return res.status(400).json({ message: 'Nominal terlalu kecil setelah fee' });

    if (!channelCode || !accountNumber || !accountName)
      return res.status(400).json({ message: 'Data rekening tidak lengkap' });

    
    
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        availableBalance: { $gte: grossAmount }, 
      },
      {
        $inc: {
          availableBalance: -grossAmount,
          walletBalance: -grossAmount,
        },
      },
      { session, new: true }
    );

    
    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Saldo tidak mencukupi. Mungkin ada transaksi lain yang sedang diproses.`,
      });
    }

    
    const referenceNo = `wd-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const [withdrawal] = await Withdrawal.create([{
      userId,
      amount: grossAmount,
      paymentMethod: paymentMethod || 'BANK',
      channelCode,
      accountNumber,
      accountName,
      status: 'PENDING',
      midtransReference: referenceNo,
      idempotencyKey,   
      note: null,
    }], { session });

    
    await createAuditLog(userId, 'WITHDRAW_REQUESTED', {
      ip: clientIp,
      amount: grossAmount,
      netAmount,
      channelCode,
      accountNumber: accountNumber.slice(-4).padStart(accountNumber.length, '*'), 
      referenceNo,
      withdrawalId: withdrawal._id,
    }, session);

    await session.commitTransaction();
    session.endSession();

    
    await sendWithdrawalNotification({
      username: user.username,
      amount: netAmount,
      paymentMethod: paymentMethod || 'BANK',
      channelCode,
      accountNumber,
      accountName,
    });

    return res.json({
      message: 'Penarikan berhasil diajukan!',
      referenceNo,
      status: 'PENDING',
      netAmount,
    });

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();

    
    await createAuditLog(userId, 'WITHDRAW_ERROR', {
      ip: clientIp,
      error: err.message,
    }).catch(() => {}); 

    console.error('[requestWithdrawal] Error:', err);
    return res.status(500).json({ message: 'Terjadi kesalahan sistem' });
  }
};

  
  
  
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

  exports.sendGhostAlert = async (req, res) => {
    const { targetUserId, donorName, amount, message, mediaUrl, mediaType, voiceUrl, startTime } = req.body;

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

      const finalStartTime = startTime || 0;
      const finalMediaUrl = toYouTubeEmbed(mediaUrl, finalStartTime);

      const payload = {
        donorName: donorName || 'SuperAdmin 👑',
        amount: Number(amount),
        message: message || '',
        mediaUrl: finalMediaUrl,
        mediaType: mediaType || null,
        startTime: finalStartTime,
        voiceUrl: voiceUrl || null,
        receivedAt: new Date().toISOString(),
        soundUrl,
        isGhostAlert: true,
      };

      
      
      if (payload.voiceUrl && !payload.mediaUrl) {
        
        io.to(`${streamer.overlayToken}-voice`).emit('new-voice-donation', payload);
        console.log(`[GhostAlert] 🎙️ Voice → @${streamer.username} (room -voice)`);
      } 
      else if (payload.mediaUrl) {
        
        io.to(`${streamer.overlayToken}-mediashare`).emit('new-media-donation', payload);
        console.log(`[GhostAlert] 🎬 MediaShare → @${streamer.username} (room -mediashare)`);
      } 
      else {
        
        io.to(streamer.overlayToken).emit('new-donation', payload);
        console.log(`[GhostAlert] 💜 Alert → @${streamer.username} (main room)`);
      }

      return res.json({
        message: `Ghost alert berhasil dikirim ke @${streamer.username}`,
        target: streamer.username,
        amount: Number(amount),
        displayDuration,
        media: { url: mediaUrl, startTime: finalStartTime },
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

  
  exports.enable2FA = async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

      
      const secret = speakeasy.generateSecret({ name: `TTT Streamer (${user.email || user.username})` });
      user.twoFactorSecret = secret.base32;
      user.twoFactorEnabled = false; 
      await user.save();

      const otpauth = speakeasy.otpauthURL({
        secret: user.twoFactorSecret,
        label: user.email || user.username,
        issuer: 'TTT Streamer',
        encoding: 'base32',
      });

      const qrCodeUrl = await QRCode.toDataURL(otpauth);

      res.json({
        success: true,
        qrCodeUrl,
        secret: user.twoFactorSecret,
        message: 'Scan QR Code ini menggunakan Google Authenticator'
      });

    } catch (err) {
      console.error('[Enable 2FA]', err);
      res.status(500).json({ message: 'Gagal mengaktifkan 2FA' });
    }
  };

  exports.verify2FA = async (req, res) => {
    try {
      const { totpCode } = req.body;
      const user = await User.findById(req.user.id);
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ message: 'Belum generate QR Code. Klik Aktifkan dulu.' });
      }

      const isValid = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      });

      if (!isValid) {
        return res.status(401).json({ message: 'Kode salah. Pastikan waktu HP sudah sinkron.' });
      }

      
      user.twoFactorEnabled = true;
      await user.save();

      res.json({ success: true, message: 'Google Authenticator berhasil diaktifkan!' });

    } catch (err) {
      console.error('[Verify 2FA]', err);
      res.status(500).json({ message: 'Gagal verifikasi 2FA' });
    }
  };

  
  exports.get2FAStatus = async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      res.json({
        twoFactorEnabled: user?.twoFactorEnabled || false,
        hasSecret: !!user?.twoFactorSecret
      });
    } catch (err) {
      res.status(500).json({ message: 'Gagal mengambil status' });
    }
  };