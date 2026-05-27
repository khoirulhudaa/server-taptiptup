// routers/announcementRouter.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/authMiddleware');
const superAdminMiddleware = require('../middleware/superAdminMiddleware');
const Announcement = require('../models/announcement');
const uploadAnnouncement = require('../middleware/cloudinaryUpload');

// ─── Multer setup for image upload ──────────────────────────────────────────

const uploadDir = path.join(__dirname, '../public/uploads/announcements');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Hanya file gambar yang diizinkan'));
    }
    cb(null, true);
  },
});

// ─── Helper: build public URL ────────────────────────────────────────────────

const getImageUrl = (result) => result?.secure_url || null;

// ─── SUPER ADMIN ROUTES ──────────────────────────────────────────────────────

// GET  /api/announcements/admin         — semua pengumuman (termasuk expired/inactive)
// POST /api/announcements/admin         — buat pengumuman baru
// PUT  /api/announcements/admin/:id     — edit pengumuman
// DELETE /api/announcements/admin/:id   — hapus pengumuman

router.get('/admin', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, isActive } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const [announcements, total] = await Promise.all([
      Announcement.find(filter)
        .populate('createdBy', 'username')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Announcement.countDocuments(filter),
    ]);

    // Tambahkan readCount ke setiap announcement
    const enriched = announcements.map(a => ({
      ...a,
      readCount: a.readBy?.length || 0,
    }));

    res.json({
      announcements: enriched,
      pagination: {
        total,
        page: Number(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin', authMiddleware, superAdminMiddleware, uploadAnnouncement.single('image'), async (req, res) => {
  try {
    const { title, description, type, expiresAt, isActive } = req.body;

    if (!title || !description) {
      return res.status(400).json({ message: 'Judul dan deskripsi wajib diisi' });
    }

    const imageUrl = req.file ? getImageUrl(req.file) : null;   // ← Cloudinary

    const announcement = await Announcement.create({
      title: title.trim(),
      description: description.trim(),
      imageUrl,
      type: type || 'info',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: isActive !== 'false',
      createdBy: req.user.id,
    });

    res.status(201).json(announcement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update route PUT juga
router.put('/admin/:id', authMiddleware, superAdminMiddleware, uploadAnnouncement.single('image'), async (req, res) => {
  try {
    const { title, description, type, expiresAt, isActive, removeImage } = req.body;
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) return res.status(404).json({ message: 'Pengumuman tidak ditemukan' });

    // Hapus gambar lama di Cloudinary jika ada yang baru atau diminta hapus
    if ((req.file || removeImage === 'true') && announcement.imageUrl) {
      const publicId = announcement.imageUrl.split('/').pop().split('.')[0]; // ambil public_id
      await cloudinary.uploader.destroy(`announcements/${publicId}`);
      announcement.imageUrl = null;
    }

    if (req.file) {
      announcement.imageUrl = getImageUrl(req.file);
    }

    if (title) announcement.title = title.trim();
    if (description) announcement.description = description.trim();
    if (type) announcement.type = type;
    if (expiresAt !== undefined) announcement.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (isActive !== undefined) announcement.isActive = isActive !== 'false';

    await announcement.save();
    res.json(announcement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/admin/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ message: 'Tidak ditemukan' });

    // Hapus file gambar jika ada
    if (announcement.imageUrl) {
      const filePath = path.join(__dirname, '../public', announcement.imageUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await announcement.deleteOne();
    res.json({ message: 'Pengumuman dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── USER ROUTES ─────────────────────────────────────────────────────────────

// GET  /api/announcements               — ambil pengumuman aktif (untuk inbox user)
// POST /api/announcements/:id/read      — tandai sudah dibaca

router.get('/', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    })
      .select('-readBy') // Jangan expose siapa yang baca
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Tambahkan flag apakah user sudah baca
    const userId = req.user.id;
    const withReadStatus = await Promise.all(
      announcements.map(async (a) => {
        const full = await Announcement.findById(a._id).select('readBy').lean();
        const isRead = full.readBy?.some(r => r.userId?.toString() === userId) || false;
        return { ...a, isRead };
      })
    );

    res.json(withReadStatus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Hitung unread count (untuk badge notifikasi)
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const userId = req.user.id;

    const all = await Announcement.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).select('readBy').lean();

    const unread = all.filter(
      (a) => !a.readBy?.some(r => r.userId?.toString() === userId)
    ).length;

    res.json({ unread });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    await Announcement.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: { userId, readAt: new Date() } },
    });
    res.json({ message: 'Ditandai sudah dibaca' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Tandai semua sudah dibaca
router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const userId = req.user.id;

    const announcements = await Announcement.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      'readBy.userId': { $ne: userId },
    }).select('_id');

    await Promise.all(
      announcements.map((a) =>
        Announcement.findByIdAndUpdate(a._id, {
          $addToSet: { readBy: { userId, readAt: new Date() } },
        })
      )
    );

    res.json({ message: 'Semua sudah dibaca', count: announcements.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;