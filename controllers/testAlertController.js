const { User, OverlaySetting } = require('../models');
const { donationQueue } = require('../utils/donationQueue');

// Helper durasi (sama seperti di midtransController)
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

exports.sendInstantTestAlert = async (req, res) => {
  const { 
    targetUsername, 
    donorName = 'Test Donor', 
    amount = 50000, 
    message = 'Ini adalah test alert dari dashboard!', 
    mediaUrl = null, 
    mediaType = null,
    voiceUrl = null,
  } = req.body;

  if (!targetUsername) {
    return res.status(400).json({ message: 'targetUsername wajib diisi' });
  }

  try {
    // Cari streamer berdasarkan username
    const streamer = await User.findOne({ username: targetUsername }).lean();
    if (!streamer) {
      return res.status(404).json({ message: `Streamer @${targetUsername} tidak ditemukan` });
    }

    if (!streamer.overlayToken) {
      return res.status(400).json({ message: 'Streamer belum memiliki overlay token' });
    }

    // Ambil setting overlay
    const overlaySetting = await OverlaySetting.findOne({ userId: streamer._id });

    const displayDuration = getDisplayDuration(Number(amount), overlaySetting);

    const soundUrl = overlaySetting?.soundUrl || null;

    const io = req.app.get('socketio');
    if (!io) {
      return res.status(500).json({ message: 'Socket.IO tidak tersedia' });
    }

    const payload = {
      donorName,
      amount: Number(amount),
      message,
      mediaUrl,
      mediaType,
      receivedAt: new Date().toISOString(),
      soundUrl,
      isTestAlert: true,
      isGhostAlert: true,
      voiceUrl,
    };

    // Kirim ke antrian agar konsisten dengan donasi normal
    if (!donationQueue || typeof donationQueue.enqueue !== 'function') {
      return res.status(500).json({ message: 'Donation queue tidak tersedia' });
    }
    
    donationQueue.enqueue(streamer.overlayToken, payload, io, displayDuration);

    console.log(`[Instant Test Alert] Dikirim ke @${streamer.username} | Rp${amount}`);

    return res.json({
      success: true,
      message: `Test alert berhasil dikirim ke @${streamer.username}`,
      target: streamer.username,
      amount: Number(amount),
      displayDuration: Math.round(displayDuration / 1000) + ' detik'
    });

  } catch (err) {
    console.error('[sendInstantTestAlert] Error:', err);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: err.message });
  }
};