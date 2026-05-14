// const { Subathon } = require('../models');
// const { emitDonationUpdate } = require('../utils/socketHelpers');

// const formatSeconds = (s) => {
//   const h = Math.floor(s / 3600);
//   const m = Math.floor((s % 3600) / 60);
//   const sec = s % 60;
//   if (h > 0) return `${h}h ${m}m ${sec}s`;
//   return `${m}m ${sec}s`;
// };

// // GET — ambil timer milik user
// exports.getTimer = async (req, res) => {
//   try {
//     let timer = await Subathon.findOne({ userId: req.user.id });
//     if (!timer) {
//       timer = await Subathon.create({ 
//         userId: req.user.id,
//         durationTiers: [  // **DEFAULT TIERS ala Saweria**
//           { amount: 5000, hours: 0, minutes: 1, seconds: 0 },
//           { amount: 10000, hours: 0, minutes: 2, seconds: 30 },
//           { amount: 25000, hours: 0, minutes: 5, seconds: 0 },
//           { amount: 50000, hours: 1, minutes: 0, seconds: 0 },
//           { amount: 100000, hours: 2, minutes: 30, seconds: 0 }
//         ]
//       });
//     }
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // **FIX & CLEAN: updateConfig**
// exports.updateConfig = async (req, res) => {
//   try {
//     const allowed = [
//       'mode', 'initialSeconds', 'autoAddEnabled', 
//       'maxSeconds', 'title', 'durationTiers'
//     ];
    
//     const update = {};
//     allowed.forEach(k => {
//       if (req.body[k] !== undefined) update[k] = req.body[k];
//     });

//     const timer = await Subathon.findOneAndUpdate(
//       { userId: req.user.id },
//       { $set: update },
//       { new: true, upsert: true }
//     );

//     _emit(req, req.user.id, 'subathon-updated', timer);
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // **FIX: handleDonationTier**
// exports.handleDonationTier = async (req, userId, amount) => {
//   try {
//     const timer = await Subathon.findOne({ userId });
//     if (!timer || !timer.isRunning || !timer.autoAddEnabled) return null;

//     const addedSeconds = timer.getTierSeconds(amount);
//     if (addedSeconds <= 0) return null;

//     let newVal = timer.currentSeconds + addedSeconds;
//     if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
    
//     timer.currentSeconds = newVal;
//     await timer.save();

//     // **DIRECT EMIT - COPY PASTE INI**
//     const io = req.app.get('socketio');
//     if (io && addedSeconds > 0) {
//       const { User } = require('../models');
//       const user = await User.findById(userId);
//       if (user?.overlayToken) {
//         const formatSeconds = (s) => {
//           const h = Math.floor(s / 3600);
//           const m = Math.floor((s % 3600) / 60);
//           const sec = s % 60;
//           if (h > 0) return `${h}h ${m}m ${sec}s`;
//           return `${m}m ${sec}s`;
//         };
        
//         io.to(user.overlayToken).emit('donation-added-time', {
//           amount,
//           addedSeconds,
//           message: `+${formatSeconds(addedSeconds)}`,
//           tier: true
//         });
//         console.log(`✅ Tier hit: Rp${amount.toLocaleString()} → +${formatSeconds(addedSeconds)}`);
//       }
//     }

//     return { timer, addedSeconds, tierAmount: amount };
//   } catch (err) {
//     console.error('handleDonationTier:', err);
//     return null;
//   }
// };

// // **FINAL: handleDonationPaid (panggil tier dulu)**
// exports.handleDonationPaid = async (userId, amount) => {
//   // Prioritas: Tier exact match
//   const tierResult = await exports.handleDonationTier(userId, amount);
//   if (tierResult) return tierResult;
  
//   // Fallback: Sistem lama (per Rp 10k = +60 detik)
//   try {
//     const timer = await Subathon.findOne({ userId });
//     if (!timer || !timer.isRunning || !timer.autoAddEnabled) return null;

//     const units = Math.floor(amount / (timer.addPerAmount || 10000));
//     const add = units * (timer.addSecondsPerAmount || 60);
    
//     if (add <= 0) return null;

//     let newVal = timer.currentSeconds + add;
//     if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
//     timer.currentSeconds = newVal;
//     await timer.save();

//      const io = req.app.get('socketio');
//     if (addedSeconds > 0 && io) {
//       await emitDonationUpdate(io, timer.userId, amount, addedSeconds);
//     }

//   return { timer, addedSeconds, tierAmount: amount };

//   } catch (err) {
//     console.error('Fallback add time error:', err);
//     return null;
//   }
// };

// // POST /start
// exports.start = async (req, res) => {
//   try {
//     const timer = await Subathon.findOneAndUpdate(
//       { userId: req.user.id },
//       { $set: { isRunning: true, startedAt: new Date(), pausedAt: null } },
//       { new: true, upsert: true }
//     );
//     _emit(req, req.user.id, 'subathon-updated', timer);
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // POST /pause
// exports.pause = async (req, res) => {
//   try {
//     const timer = await Subathon.findOneAndUpdate(
//       { userId: req.user.id },
//       { $set: { isRunning: false, pausedAt: new Date() } },
//       { new: true }
//     );
//     _emit(req, req.user.id, 'subathon-updated', timer);
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // POST /reset
// exports.reset = async (req, res) => {
//   try {
//     const timer = await Subathon.findOne({ userId: req.user.id });
//     if (!timer) return res.status(404).json({ message: 'Timer tidak ditemukan' });

//     timer.currentSeconds = timer.initialSeconds;
//     timer.isRunning = false;
//     timer.startedAt = null;
//     timer.pausedAt = null;
//     await timer.save();

//     _emit(req, req.user.id, 'subathon-updated', timer);
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // POST /add — tambah waktu manual
// exports.addTime = async (req, res) => {
//   try {
//     const { seconds } = req.body;
//     if (!seconds || seconds <= 0) return res.status(400).json({ message: 'seconds harus > 0' });

//     const timer = await Subathon.findOne({ userId: req.user.id });
//     if (!timer) return res.status(404).json({ message: 'Timer tidak ditemukan' });

//     let newVal = timer.currentSeconds + Number(seconds);
//     if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
//     timer.currentSeconds = newVal;
//     await timer.save();

//     _emit(req, req.user.id, 'subathon-updated', timer);
//     res.json(timer);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // GET publik by overlayToken (untuk widget OBS)
// exports.getPublic = async (req, res) => {
//   try {
//     const { User } = require('../models');
//     const user = await User.findOne({ overlayToken: req.params.token }).lean();
//     if (!user) return res.status(404).json({ message: 'Not found' });

//     const timer = await Subathon.findOne({ userId: user._id }).lean();
//     res.json(timer || {});
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // Helper emit socket
// const _emit = (req, userId, event, data) => {
//   try {
//     const io = req.app.get('socketio');
//     const { User } = require('../models');
//     User.findById(userId).then(u => {
//       if (io && u?.overlayToken) io.to(u.overlayToken).emit(event, data);
//     });
//   } catch (_) {}
// };

// // Dipanggil dari webhook midtrans saat donasi PAID
// exports.handleDonationPaid = async (userId, amount) => {
//   try {
//     const timer = await Subathon.findOne({ userId });
//     if (!timer || !timer.isRunning || !timer.autoAddEnabled) return;

//     const add = timer.calcAddSeconds(amount);
//     if (add <= 0) return;

//     let newVal = timer.currentSeconds + add;
//     if (timer.maxSeconds) newVal = Math.min(newVal, timer.maxSeconds);
//     timer.currentSeconds = newVal;
//     await timer.save();

//     return { timer, added: add };
//   } catch (_) {}
// };


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
        durationTiers: [  // **DEFAULT TIERS ala Saweria**
          { amount: 5000, hours: 0, minutes: 1, seconds: 0 },
          { amount: 10000, hours: 0, minutes: 2, seconds: 30 },
          { amount: 25000, hours: 0, minutes: 5, seconds: 0 },
          { amount: 50000, hours: 1, minutes: 0, seconds: 0 },
          { amount: 100000, hours: 2, minutes: 30, seconds: 0 }
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
      'maxSeconds', 'title', 'durationTiers'
    ];
    
    const update = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined) update[k] = req.body[k]; // ✅ FIXED
    });

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
    if (io && addedSeconds > 0) {
      const { User } = require('../models');
      const user = await User.findById(userId);
      if (user?.overlayToken) {
        io.to(user.overlayToken).emit('donation-added-time', {
          amount,
          addedSeconds,
          message: `+${formatSeconds(addedSeconds)}`,
          tier: true
        });
        console.log(`✅ Tier hit: Rp${amount.toLocaleString()} → +${formatSeconds(addedSeconds)}`);
      }
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