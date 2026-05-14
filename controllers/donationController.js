// controllers/donationController.js
const { Donation } = require('../models');
const mongoose = require('mongoose'); // pindah ke atas, jangan require dalam fungsi

exports.getDonationHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 50, status = 'PAID', startDate, endDate } = req.query; // ✅ DEFAULT = 'PAID'

    const query = { 
      userId: new mongoose.Types.ObjectId(userId),
      status: 'PAID' // ✅ HARUS PAID
    };

    // Override status filter - hanya PAID yang diizinkan
    if (status && status !== 'PAID') {
      return res.status(400).json({ message: 'Hanya donasi PAID yang tersedia' });
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate)   query.createdAt.$lte = new Date(endDate);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [donations, total] = await Promise.all([
      Donation.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Donation.countDocuments(query),
    ]);

    const totalPaid = await Donation.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    res.json({
      donations,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
      summary: {
        totalPaid: totalPaid[0]?.total || 0,
        totalCount: total,
      },
    });
  } catch (err) {
    console.error('[getDonationHistory] Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.getDonationStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId); // ✅ pakai 'new'

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allTime, today, thisMonth, topDonors] = await Promise.all([
      Donation.aggregate([
        { $match: { userId: userObjectId, status: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Donation.aggregate([
        { $match: { userId: userObjectId, status: 'PAID', createdAt: { $gte: startOfToday } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Donation.aggregate([
        { $match: { userId: userObjectId, status: 'PAID', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Donation.aggregate([
        { $match: { userId: userObjectId, status: 'PAID', donorName: { $ne: 'Anonim' } } },
        { $group: { _id: '$donorName', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 5 },
      ]),
    ]);

    res.json({
      allTime:   { total: allTime[0]?.total   || 0, count: allTime[0]?.count   || 0 },
      today:     { total: today[0]?.total     || 0, count: today[0]?.count     || 0 },
      thisMonth: { total: thisMonth[0]?.total || 0, count: thisMonth[0]?.count || 0 },
      topDonors: topDonors.map(d => ({ name: d._id, totalAmount: d.totalAmount, count: d.count })),
    });
  } catch (err) {
    console.error('[getDonationStats] Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

exports.getMyDonations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // ✅ FIX: Gunakan donorUserId sesuai model & data MongoDB
    const donations = await Donation.find({ 
      donorUserId: req.user.id,  // ❌ Bukan userId atau donorId
      // Tambahan: hanya tampilkan yang sudah PAID atau PENDING
      status: { $in: ['PAID', 'PENDING'] }
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('userId', 'username'); // Populate streamer

    // ✅ FIX: Count juga pakai donorUserId
    const total = await Donation.countDocuments({ 
      donorUserId: req.user.id,
      status: { $in: ['PAID', 'PENDING'] }
    });

    res.json({
      donations: donations.map(d => ({
        id: d._id,
        externalId: d.externalId,
        streamerUsername: d.userId?.username || 'Unknown',
        donorName: d.donorName,
        amount: d.amount,
        message: d.message,
        status: d.status,
        mediaUrl: d.mediaUrl,
        mediaType: d.mediaType,
        createdAt: d.createdAt,
        paymentUrl: d.paymentUrl
      })),
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNext: Number(page) < Math.ceil(total / limit),
        hasPrev: Number(page) > 1
      }
    });
  } catch (err) {
    console.error('❌ getMyDonations error:', err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/donations/sent — riwayat donasi yang dikirim oleh user yang login
exports.getSentDonations = async (req, res) => {
  try {
    const donorUserId = new mongoose.Types.ObjectId(req.user.id);
    const { page = 1, limit = 20, status } = req.query;

    const query = { donorUserId };
    if (status && ['PAID', 'PENDING', 'EXPIRED'].includes(status)) query.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [donations, total] = await Promise.all([
      Donation.find(query)
        .populate('userId', 'username')  // ambil username penerima
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Donation.countDocuments(query),
    ]);

    res.json({
      donations,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('[getSentDonations] Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};