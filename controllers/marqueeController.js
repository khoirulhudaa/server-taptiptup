const mongoose = require('mongoose');
 
// Lazy-require supaya tidak circular jika dipasang di file yang sama
 
const getModels = () => {
  const User     = mongoose.model('User');
  const Donation = mongoose.model('Donation');
  return { User, Donation };
};

const VALID_LIMITS = [5, 10, 20];
const parseLimit = (q) => VALID_LIMITS.includes(parseInt(q)) ? parseInt(q) : 10;

/**
 * GET /api/marquee/:token/top-donors?limit=10
 *
 * Publik — tidak butuh auth.
 * Mengembalikan top donor berdasarkan total amount (semua waktu, status PAID).
 */
exports.getTopDonors = async (req, res) => {
  try {
    const { User, Donation } = getModels();
 
    const user = await User.findOne({ overlayToken: req.params.token }).lean();
    if (!user) return res.status(404).json({ message: 'Token tidak valid' });
 
    const limit = parseLimit(req.query.limit);
 
    const donors = await Donation.aggregate([
      { $match: { userId: user._id, status: 'PAID' } },
      {
        $group: {
          _id:          '$donorName',
          totalAmount:  { $sum: '$amount' },
          count:        { $sum: 1 },
          lastDonation: { $max: '$createdAt' },
        },
      },
      { $sort: { totalAmount: -1 } },
      { $limit: limit },
      {
        $project: {
          _id:          0,
          donorName:    '$_id',
          totalAmount:  1,
          count:        1,
          lastDonation: 1,
        },
      },
    ]);
 
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ donors, limit });
  } catch (err) {
    console.error('[marqueeController] getTopDonors error:', err);
    res.status(500).json({ message: err.message });
  }
};
 
/**
 * GET /api/marquee/:token/recent?limit=10
 * Donasi terbaru (status PAID, diurutkan dari yang paling baru).
 */
exports.getRecentDonations = async (req, res) => {
  try {
    const { User, Donation } = getModels();
 
    const user = await User.findOne({ overlayToken: req.params.token }).lean();
    if (!user) return res.status(404).json({ message: 'Token tidak valid' });
 
    const limit = parseLimit(req.query.limit);
 
    const donations = await Donation.find(
      { userId: user._id, status: 'PAID' },
      { donorName: 1, amount: 1, message: 1, createdAt: 1 }
    )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
 
    res.set('Cache-Control', 'public, max-age=30'); // lebih pendek karena real-time
    res.json({ donations, limit });
  } catch (err) {
    console.error('[marqueeController] getRecentDonations error:', err);
    res.status(500).json({ message: err.message });
  }
};