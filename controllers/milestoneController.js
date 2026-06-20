const { default: mongoose } = require('mongoose');
const { Milestone, Donation } = require('../models');

exports.getMilestones = async (req, res) => {
  try {
    const milestones = await Milestone.find({ userId: req.user.id }).sort('order').lean();

    const buildMatch = (period, periodSince) => {
      const base = { userId: new mongoose.Types.ObjectId(req.user.id), status: 'PAID' };
      const now = new Date();
      if (period === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return { ...base, createdAt: { $gte: start } };
      }
      if (period === 'thismonth') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { ...base, createdAt: { $gte: start } };
      }
      if (period === 'since' && periodSince) {
        const start = new Date(periodSince);
        start.setHours(0, 0, 0, 0);
        return { ...base, createdAt: { $gte: start } };
      }
      return base;
    };

    const periodKeys = [...new Map(
      milestones.map(m => {
        const key = m.period === 'since' && m.periodSince
          ? `since::${new Date(m.periodSince).toISOString()}`
          : m.period || 'alltime';
        return [key, { period: m.period || 'alltime', periodSince: m.periodSince }];
      })
    ).values()];

    const totals = {};
    await Promise.all(periodKeys.map(async ({ period, periodSince }) => {
      const key = period === 'since' && periodSince
        ? `since::${new Date(periodSince).toISOString()}`
        : period;
      const result = await Donation.aggregate([
        { $match: buildMatch(period, periodSince) },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totals[key] = result[0]?.total || 0;
    }));

    const enriched = milestones.map(m => {
      const period = m.period || 'alltime';
      const key = period === 'since' && m.periodSince
        ? `since::${new Date(m.periodSince).toISOString()}`
        : period;
      const totalForPeriod = totals[key] || 0;
      const target = Number(m.targetAmount) || 0;
      return {
        ...m,
        period,
        periodSince: m.periodSince || null,
        targetAmount: target,
        currentAmount: Math.min(totalForPeriod, target),
        progress: target > 0 ? Math.min(100, Math.round((totalForPeriod / target) * 100)) : 0,
        reached: totalForPeriod >= target,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

exports.getPublicMilestones = async (req, res) => {
  const { User } = require('../models');
  const user = await User.findOne({ username: req.params.username }).lean();
  if (!user) return res.status(404).json({ message: 'Not found' });

  const milestones = await Milestone.find({ userId: user._id }).sort('order').lean();

  const buildMatch = (period, periodSince) => {
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
    if (period === 'since' && periodSince) {
      const start = new Date(periodSince);
      start.setHours(0, 0, 0, 0);
      return { ...base, createdAt: { $gte: start } };
    }
    return base; // alltime
  };

  const periodKeys = [...new Map(
    milestones.map(m => {
      const key = m.period === 'since' && m.periodSince
        ? `since::${new Date(m.periodSince).toISOString()}`
        : m.period || 'alltime';
      return [key, { period: m.period || 'alltime', periodSince: m.periodSince }];
    })
  ).values()];

  const totals = {};
  await Promise.all(periodKeys.map(async ({ period, periodSince }) => {
    const key = period === 'since' && periodSince
      ? `since::${new Date(periodSince).toISOString()}`
      : period;
    const result = await Donation.aggregate([
      { $match: buildMatch(period, periodSince) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    totals[key] = result[0]?.total || 0;
  }));

  const enriched = milestones.map(m => {
    const period = m.period || 'alltime';
    const key = period === 'since' && m.periodSince
      ? `since::${new Date(m.periodSince).toISOString()}`
      : period;
    const totalForPeriod = totals[key] || 0;
    const target = Number(m.targetAmount) || 0;
    return {
      ...m,
      period,
      periodSince: m.periodSince || null,
      targetAmount: target,
      currentAmount: Math.min(totalForPeriod, target),
      progress: target > 0 ? Math.min(100, Math.round((totalForPeriod / target) * 100)) : 0,
      reached: totalForPeriod >= target,
    };
  });

  res.json({ milestones: enriched, totalPaid: totals['alltime'] || 0 });
};