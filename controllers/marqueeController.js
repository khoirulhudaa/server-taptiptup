// controllers/marqueeController.js

const { User, Donation } = require("../models");

exports.getTopDonors = async (req, res) => {
  try {
    const user = await User.findOne({ overlayToken: req.params.token });
    if (!user) return res.status(404).json({ message: 'Token tidak valid' });

    const limit = parseInt(req.query.limit) || 10;
    const validLimits = [5, 10, 20];
    const finalLimit = validLimits.includes(limit) ? limit : 10;

    const topDonors = await Donation.aggregate([
      { $match: { userId: user._id, status: 'PAID' } },
      { $group: {
        _id: '$donorName',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
        lastDonation: { $max: '$createdAt' },
      }},
      { $sort: { totalAmount: -1 } },
      { $limit: finalLimit },
      { $project: { _id: 0, donorName: '$_id', totalAmount: 1, count: 1, lastDonation: 1 } },
    ]);

    res.json({ donors: topDonors, limit: finalLimit });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};