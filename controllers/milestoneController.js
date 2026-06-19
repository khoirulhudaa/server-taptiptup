const { Milestone, Donation } = require('../models');

exports.getMilestones = async (req, res) => {
  const milestones = await Milestone.find({ userId: req.user.id }).sort('order');
  res.json(milestones);
};

exports.upsertMilestones = async (req, res) => {
  const { milestones } = req.body; // array
  try {
    await Milestone.deleteMany({ userId: req.user.id });
    const docs = milestones.map((m, i) => ({ ...m, userId: req.user.id, order: i }));
    const created = await Milestone.insertMany(docs);
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Public: untuk widget embed (leaderboard + milestones)
// exports.getPublicMilestones = async (req, res) => {
//   const { User } = require('../models');
//   const user = await User.findOne({ username: req.params.username }).lean();
//   if (!user) return res.status(404).json({ message: 'Not found' });
//   const milestones = await Milestone.find({ userId: user._id }).sort('order').lean();
//   // Hitung progress dari total donasi PAID
//   const result = await Donation.aggregate([
//     { $match: { userId: user._id, status: 'PAID' } },
//     { $group: { _id: null, total: { $sum: '$amount' } } },
//   ]);
//   const totalPaid = result[0]?.total || 0;
//   const enriched = milestones.map(m => ({
//     ...m,
//     currentAmount: Math.min(totalPaid, m.targetAmount),
//     progress: Math.min(100, Math.round((totalPaid / m.targetAmount) * 100)),
//     reached: totalPaid >= m.targetAmount,
//   }));
//   res.json({ milestones: enriched, totalPaid });
// };

exports.getPublicMilestones = async (req, res) => {
  const { User } = require('../models');
  const user = await User.findOne({ username: req.params.username }).lean();
  if (!user) return res.status(404).json({ message: 'Not found' });

  const milestones = await Milestone.find({ userId: user._id }).sort('order').lean();

  // Hitung total donasi per periode
  const buildMatch = (period) => {
    const base = { userId: user._id, status: 'PAID' };
    const now = new Date();
    if (period === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { ...base, createdAt: { $gte: start } };
    }
    if (period === 'thismonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { ...base, createdAt: { $gte: start } };
    }
    return base; // alltime
  };

  // Ambil total unik per periode yang dibutuhkan (hindari query duplikat)
  const periods = [...new Set(milestones.map(m => m.period || 'alltime'))];
  const totals = {};
  await Promise.all(periods.map(async (period) => {
    const result = await Donation.aggregate([
      { $match: buildMatch(period) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    totals[period] = result[0]?.total || 0;
  }));

  const enriched = milestones.map(m => {
    const period = m.period || 'alltime';
    const totalForPeriod = totals[period];
    return {
      ...m,
      period,
      currentAmount: Math.min(totalForPeriod, m.targetAmount),
      progress: Math.min(100, Math.round((totalForPeriod / m.targetAmount) * 100)),
      reached: totalForPeriod >= m.targetAmount,
    };
  });

  res.json({ milestones: enriched, totalPaid: totals['alltime'] || 0 });
};