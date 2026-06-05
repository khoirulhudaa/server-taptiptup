// routers/streamerManageRouter.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { User } = require('../models');

// Middleware: hanya superAdmin
const superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'superAdmin') {
    return res.status(403).json({ message: 'Akses ditolak. Super Admin only.' });
  }
  next();
};

// ─── GET daftar semua user (dengan pagination + search) ──────────────────────
// GET /api/streamer-manage?page=1&limit=20&search=keyword&status=active|inactive
router.get('/', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const search = (req.query.search || '').trim();
    const status = req.query.status || ''; // 'active' | 'inactive' | ''

    const filter = { role: { $ne: 'superAdmin' } };

    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email:    { $regex: search, $options: 'i' } },
      ];
    }

    if (status === 'active')   filter.isActive = { $ne: false };
    if (status === 'inactive') filter.isActive = false;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -securityPin -verifyPin -resetPasswordToken')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('GET /streamer-manage:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/mark-role-upgrade-notified', authMiddleware, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { roleUpgradeNotified: true });
  res.json({ success: true });
});

router.put('/:id/change-role', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { role } = req.body;

    if (!['user', 'superAdmin', 'streamerSuper'].includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid. Gunakan: user atau streamerSuper' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
    if (user.role === 'streamerSuper' && role === 'streamerSuper') {
      return res.status(400).json({ message: 'User sudah menjadi superAdmin' });
    }

    user.role = role;
    await user.save();

    res.json({
      message: `Role @${user.username} diubah menjadi ${role}`,
      role: user.role,
    });
  } catch (err) {
    console.error('change-role:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── TOGGLE aktif/nonaktif ────────────────────────────────────────────────────
// PUT /api/streamer-manage/:id/toggle-active
router.put('/:id/toggle-active', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
    if (user.role === 'superAdmin') return res.status(403).json({ message: 'Tidak bisa menonaktifkan superAdmin' });

    user.isActive = user.isActive === false ? true : false;
    await user.save();

    res.json({ message: `User ${user.isActive ? 'diaktifkan' : 'dinonaktifkan'}`, isActive: user.isActive });
  } catch (err) {
    console.error('toggle-active:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── HAPUS permanen ──────────────────────────────────────────────────────────
// DELETE /api/streamer-manage/:id
router.delete('/:id', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
    if (user.role === 'superAdmin') return res.status(403).json({ message: 'Tidak bisa menghapus superAdmin' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `User @${user.username} berhasil dihapus permanen` });
  } catch (err) {
    console.error('delete user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;