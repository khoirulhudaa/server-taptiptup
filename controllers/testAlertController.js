// controllers/testAlertController.js
const { User, OverlaySetting } = require('../models');
const { donationQueue } = require('../utils/donationQueue');

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

exports.sendInstantTestAlert = async (req, res) => {
  const {
    targetUsername,
    donorName = 'Test Donor',
    amount    = 50000,
    message   = 'Ini adalah test alert dari dashboard!',
    mediaUrl  = null,
    mediaType = null,
    voiceUrl  = null,
  } = req.body;

  if (!targetUsername) {
    return res.status(400).json({ message: 'targetUsername wajib diisi' });
  }

  try {
    const streamer = await User.findOne({ username: targetUsername }).lean();
    if (!streamer) {
      return res.status(404).json({ message: `Streamer @${targetUsername} tidak ditemukan` });
    }
    if (!streamer.overlayToken) {
      return res.status(400).json({ message: 'Streamer belum memiliki overlay token' });
    }

    const overlaySetting  = await OverlaySetting.findOne({ userId: streamer._id });
    const parsedAmount    = Number(amount);
    const displayDuration = getDisplayDuration(parsedAmount, overlaySetting);
    const soundUrl        = overlaySetting?.getSoundForAmount
      ? overlaySetting.getSoundForAmount(parsedAmount)
      : (overlaySetting?.soundUrl || null);

    const io = req.app.get('socketio');
    if (!io) return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
    if (typeof donationQueue?.enqueue !== 'function') {
      return res.status(500).json({ message: 'Donation queue tidak tersedia' });
    }

    const payload = {
      donorName,
      amount:      parsedAmount,
      message,
      mediaUrl,
      mediaType,
      voiceUrl,
      soundUrl,
      receivedAt:   new Date().toISOString(),
      isTestAlert:  true,
      isGhostAlert: true,
    };

    donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);

    console.log(`[TestAlert] @${req.user?.username} → @${streamer.username} | Rp${parsedAmount}${voiceUrl ? ' [+voice]' : ''}`);

    return res.json({
      success:         true,
      message:         `Test alert berhasil dikirim ke @${streamer.username}`,
      target:          streamer.username,
      amount:          parsedAmount,
      displayDuration: Math.round(displayDuration / 1000) + ' detik',
      hasVoice:        !!voiceUrl,
    });
  } catch (err) {
    console.error('[sendInstantTestAlert] Error:', err);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: err.message });
  }
};