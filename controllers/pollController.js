const { Poll } = require('../models');

// GET — ambil poll aktif milik user (dashboard)
exports.getMyPolls = async (req, res) => {
  try {
    const polls = await Poll.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
    res.json(polls);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST — buat poll baru
exports.create = async (req, res) => {
  try {
    const { question, options, showResults } = req.body;
    if (!question || !options || options.length < 2) {
      return res.status(400).json({ message: 'Minimal 2 opsi' });
    }

    // Tutup semua poll aktif dulu (1 poll aktif per user)
    await Poll.updateMany({ userId: req.user.id, status: 'active' }, { status: 'closed' });

    const poll = await Poll.create({
      userId: req.user.id,
      question,
      options: options.map(text => ({ text, votes: 0 })),
      showResults: showResults !== false,
    });

    _emit(req, req.user.id, 'poll-updated', poll);
    res.json(poll);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /:id/close
exports.close = async (req, res) => {
  try {
    const poll = await Poll.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { status: 'closed' },
      { new: true }
    );
    if (!poll) return res.status(404).json({ message: 'Poll tidak ditemukan' });

    _emit(req, req.user.id, 'poll-updated', poll);
    res.json(poll);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /:id
exports.remove = async (req, res) => {
  try {
    await Poll.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ message: 'Poll dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET publik by username — untuk halaman voting
exports.getActive = async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findOne({ username: req.params.username }).lean();
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    const poll = await Poll.findOne({ userId: user._id, status: 'active' }).lean();
    res.json(poll || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST publik /:id/vote — submit vote
exports.vote = async (req, res) => {
  try {
    const { optionId, email } = req.body;
    if (!email || !optionId) return res.status(400).json({ message: 'email dan optionId wajib diisi' });

    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ message: 'Poll tidak ditemukan' });
    if (poll.status === 'closed') return res.status(400).json({ message: 'Poll sudah ditutup' });

    // Cek 1 email 1 vote
    if (poll.voters.includes(email.toLowerCase())) {
      return res.status(400).json({ message: 'Kamu sudah voting sebelumnya' });
    }

    const option = poll.options.id(optionId);
    if (!option) return res.status(400).json({ message: 'Opsi tidak valid' });

    option.votes += 1;
    poll.voters.push(email.toLowerCase());
    await poll.save();

    _emit_by_userid(req, poll.userId, 'poll-updated', poll);
    res.json({ message: 'Vote berhasil!', poll });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET widget OBS by token
exports.getPublicByToken = async (req, res) => {
  try {
    const { User } = require('../models');
    const user = await User.findOne({ overlayToken: req.params.token }).lean();
    if (!user) return res.status(404).json({ message: 'Not found' });

    const poll = await Poll.findOne({ userId: user._id, status: 'active' }).lean();
    res.json(poll || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const _emit = (req, userId, event, data) => {
  try {
    const io = req.app.get('socketio');
    const { User } = require('../models');
    User.findById(userId).then(u => {
      if (io && u?.overlayToken) io.to(u.overlayToken).emit(event, data);
    });
  } catch (_) {}
};

const _emit_by_userid = (req, userId, event, data) => _emit(req, userId, event, data);