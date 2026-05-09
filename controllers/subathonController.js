const { Subathon } = require('../models');

// GET — ambil timer milik user
exports.getTimer = async (req, res) => {
  try {
    let timer = await Subathon.findOne({ userId: req.user.id });
    if (!timer) {
      timer = await Subathon.create({ userId: req.user.id });
    }
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT — update config timer
exports.updateConfig = async (req, res) => {
  try {
    const allowed = [
      'mode', 'initialSeconds', 'autoAddEnabled',
      'addSecondsPerAmount', 'addPerAmount', 'maxSeconds', 'title'
    ];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const timer = await Subathon.findOneAndUpdate(
      { userId: req.user.id },
      { $set: update },
      { new: true, upsert: true }
    );

    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /start
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

// POST /pause
exports.pause = async (req, res) => {
  try {
    const timer = await Subathon.findOneAndUpdate(
      { userId: req.user.id },
      { $set: { isRunning: false, pausedAt: new Date() } },
      { new: true }
    );
    _emit(req, req.user.id, 'subathon-updated', timer);
    res.json(timer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /reset
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

// POST /add — tambah waktu manual
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

// GET publik by overlayToken (untuk widget OBS)
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

// Dipanggil dari webhook midtrans saat donasi PAID
exports.handleDonationPaid = async (userId, amount) => {
  try {
    const timer = await Subathon.findOne({ userId });
    if (!timer || !timer.isRunning || !timer.autoAddEnabled) return;

    const add = timer.calcAddSeconds(amount);
    if (add <= 0) return;

    let newVal = timer.currentSeconds + add;
    if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
    timer.currentSeconds = newVal;
    await timer.save();

    return { timer, added: add };
  } catch (_) {}
};