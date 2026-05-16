const { Subathon } = require('../models');

const formatSeconds = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
};

// GET — ambil timer milik user
exports.getTimer = async (req, res) => {
  try {
    let timer = await Subathon.findOne({ userId: req.user.id });
    if (!timer) {
      timer = await Subathon.create({ 
      userId: req.user.id,
      durationTiers: [  
        // **FLEKSIBEL untuk kelipatan 1000**
        { amount: 1000, hours: 0, minutes: 0, seconds: 30 },   // 1k = 30 detik
        { amount: 5000, hours: 0, minutes: 1, seconds: 0 },    // 5k = 1 menit
        { amount: 10000, hours: 0, minutes: 2, seconds: 30 },  // 10k = 2m30s
        { amount: 25000, hours: 0, minutes: 5, seconds: 0 },   // 25k = 5 menit
        { amount: 50000, hours: 1, minutes: 0, seconds: 0 },   // 50k = 1 jam
        { amount: 100000, hours: 2, minutes: 30, seconds: 0 }  // 100k = 2 jam 30 menit
      ]
    });
    }
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// **FIX: updateConfig**
exports.updateConfig = async (req, res) => {
  try {
    const allowed = [
      'mode', 'initialSeconds', 'autoAddEnabled', 
      'maxSeconds', 'title', 'durationTiers', 'addSecondsPerAmount', 'addPerAmount'
    ];
    
    const update = {};
    allowed.forEach(k => {
      // **FIX: Cek undefined/null/empty**
      if (req.body.hasOwnProperty(k) && req.body[k] !== undefined && req.body[k] !== null) {
        update[k] = req.body[k];
      }
    });

    const timer = await Subathon.findOneAndUpdate(
      { userId: req.user.id },
      { $set: update },
      { new: true, upsert: true }
    );

    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    console.error('updateConfig error:', err);
    res.status(500).json({ message: err.message });
  }
};

// **FIX: handleDonationTier**
exports.handleDonationTier = async (req, userId, amount) => {
  try {
    const timer = await Subathon.findOne({ userId });
    if (!timer || !timer.isRunning || !timer.autoAddEnabled) return null;

    const addedSeconds = timer.getTierSeconds(amount);
    if (addedSeconds <= 0) return null;

    let newVal = timer.currentSeconds + addedSeconds;
    if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
    
    timer.currentSeconds = newVal;
    await timer.save();

    // **EMIT SOCKET**
    const io = req.app.get('socketio');
    if (io && user?.overlayToken) {
      // Emit subathon-updated agar widget & manager sync
      io.to(user.overlayToken).emit('subathon-updated', timer);
      
      // Emit donation-added-time untuk animasi overlay (opsional)
      io.to(user.overlayToken).emit('donation-added-time', {
        amount,
        addedSeconds,
        message: `+${formatSeconds(addedSeconds)}`,
      });
    }

    return { timer, addedSeconds, tierAmount: amount };
  } catch (err) {
    console.error('handleDonationTier:', err);
    return null;
  }
};

// **FINAL: handleDonationPaid (FIXED)**
exports.handleDonationPaid = async (req, userId, amount) => { // ✅ req ditambah
  try {
    // 1. Coba tier exact match DULU
    const tierResult = await exports.handleDonationTier(req, userId, amount);
    if (tierResult) return tierResult;
    
    // 2. Fallback sistem lama
    const timer = await Subathon.findOne({ userId });
    if (!timer || !timer.isRunning || !timer.autoAddEnabled) return null;

    const units = Math.floor(amount / (timer.addPerAmount || 10000));
    const add = units * (timer.addSecondsPerAmount || 60);
    
    if (add <= 0) return null;

    let newVal = timer.currentSeconds + add;
    if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
    timer.currentSeconds = newVal;
    await timer.save();

    console.log(`✅ Fallback: Rp${amount.toLocaleString()} → +${formatSeconds(add)}`);

    return { timer, added: add, fallback: true };
  } catch (err) {
    console.error('handleDonationPaid:', err);
    return null;
  }
};

// POST /start, /pause, /reset, /addTime, /getPublic → SAMA PERSIS
exports.start = async (req, res) => {
  try {
    const timer = await Subathon.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { isRunning: true, startedAt: new Date(), pausedAt: null } },
      { new: true, upsert: true }
    );
    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.pause = async (req, res) => {
  try {
    const { currentSeconds } = req.body; // terima dari client
    const timer = await Subathon.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { isRunning: false, pausedAt: new Date(), currentSeconds } },
      { new: true }
    );
    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.reset = async (req, res) => {
  try {
    const timer = await Subathon.findOne({ userId: req.user.id });
    if (!timer) return res.status(404).json({ message: 'Timer tidak ditemukan' });

    timer.currentSeconds = timer.initialSeconds;
    timer.isRunning = false;
    timer.startedAt = null;
    timer.pausedAt = null;
    await timer.save();

    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addTime = async (req, res) => {
  try {
    const { seconds } = req.body;
    if (!seconds || seconds <= 0) return res.status(400).json({ message: 'seconds harus > 0' });

    const timer = await Subathon.findOne({ userId: req.user.id });
    if (!timer) return res.status(404).json({ message: 'Timer tidak ditemukan' });

    let newVal = timer.currentSeconds + Number(seconds);
    if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
    timer.currentSeconds = newVal;
    await timer.save();

    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getPublic = async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findOne({ overlayToken: req.params.token }).lean();
    if (!user) return res.status(404).json({ message: 'Not found' });

    const timer = await Subathon.findOne({ userId: user._id }).lean();
    res.json(timer || {});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Helper emit socket
const _emit = (req, userId, event, data) => {
  try {
    const io = req.app.get('socketio');
    const { User } = require('../models');
    User.findById(userId).then(u => {
      if (io && u?.overlayToken) io.to(u.overlayToken).emit(event, data);
    });
  } catch (_) {}
};