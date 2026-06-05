// routers/superAdminRouter.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
// const superAdminMiddleware = require('../middleware/superAdminMiddleware');
const { User, Donation, Withdrawal } = require('../models');
const mongoose = require('mongoose');

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalDonationAgg,
      totalWithdrawalAgg,
      pendingWithdrawals,
      topDonors,
      monthlyRevenue,
      recentDonations,
    ] = await Promise.all([
      // Jumlah user (bukan superAdmin)
      User.countDocuments({ role: 'user' }),

      // Total donasi masuk dari semua user
      Donation.aggregate([
        { $match: { status: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),

      // Total pencairan (COMPLETED)
      Withdrawal.aggregate([
        { $match: { status: 'COMPLETED' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),

      // Pending withdrawals
      Withdrawal.countDocuments({ status: 'PENDING' }),

      // Top 3 donatur dari semua user
      Donation.aggregate([
        { $match: { status: 'PAID', donorName: { $ne: 'Anonim' } } },
        { $group: { _id: '$donorName', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 3 }
      ]),

      // Revenue per bulan (6 bulan terakhir)
      Donation.aggregate([
        { $match: { status: 'PAID', createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } },
        {
          $group: {
            _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),

      // 5 donasi terbaru
      Donation.find({ status: 'PAID' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('userId', 'username')
        .lean(),
    ]);

    res.json({
      totalUsers,
      totalDonation: {
        amount: totalDonationAgg[0]?.total || 0,
        count: totalDonationAgg[0]?.count || 0,
      },
      totalWithdrawal: {
        amount: totalWithdrawalAgg[0]?.total || 0,
        count: totalWithdrawalAgg[0]?.count || 0,
      },
      pendingWithdrawals,
      topDonors: topDonors.map(d => ({ name: d._id, totalAmount: d.totalAmount, count: d.count })),
      monthlyRevenue,
      recentDonations,
    });
  } catch (err) {
    console.error('[SuperAdmin Stats]', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;