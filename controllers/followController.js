// controllers/followController.js
const { Follow, User } = require('../models');
const mongoose = require('mongoose');

// ── Toggle Follow/Unfollow ────────────────────────────────────────────────────
exports.toggleFollow = async (req, res) => {
  try {
    const followerId  = req.user.id;
    const followingId = req.params.userId;

    if (followerId === followingId) {
      return res.status(400).json({ message: 'Tidak bisa follow diri sendiri' });
    }

    const target = await User.findById(followingId).select('username').lean();
    if (!target) return res.status(404).json({ message: 'User tidak ditemukan' });

    const existing = await Follow.findOne({ follower: followerId, following: followingId });

    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
      return res.json({ following: false, message: `Unfollow @${target.username}` });
    }

    await Follow.create({ follower: followerId, following: followingId });
    return res.json({ following: true, message: `Mengikuti @${target.username}` });

  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

// ── Daftar Followers (yang mengikuti userId) ──────────────────────────────────
exports.getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [followers, total] = await Promise.all([
      Follow.find({ following: userId })
        .populate('follower', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Follow.countDocuments({ following: userId }),
    ]);

    res.json({
      users: followers.map(f => f.follower),
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

// ── Daftar Following (yang diikuti userId) ────────────────────────────────────
exports.getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [following, total] = await Promise.all([
      Follow.find({ follower: userId })
        .populate('following', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Follow.countDocuments({ follower: userId }),
    ]);

    res.json({
      users: following.map(f => f.following),
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

// ── Stats + status follow untuk user yang login ───────────────────────────────
exports.getFollowStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const myId = req.user?.id;

    const [followersCount, followingCount, isFollowing] = await Promise.all([
      Follow.countDocuments({ following: userId }),
      Follow.countDocuments({ follower: userId }),
      myId && myId !== userId
        ? Follow.exists({ follower: myId, following: userId })
        : Promise.resolve(null),
    ]);

    res.json({ followersCount, followingCount, isFollowing: !!isFollowing });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};

// ── Discover: daftar semua streamer + status follow ───────────────────────────
exports.discoverStreamers = async (req, res) => {
  try {
    const myId = req.user.id;
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const searchQuery = search
      ? { username: { $regex: search, $options: 'i' }, _id: { $ne: myId } }
      : { _id: { $ne: myId } };

    const [users, total] = await Promise.all([
      User.find(searchQuery)
        .select('username email profilePicture createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(searchQuery),
    ]);

    // Ambil semua following saya sekaligus untuk cek status
    const myFollowing = await Follow.find({ follower: myId })
      .select('following')
      .lean();
    const followingSet = new Set(myFollowing.map(f => f.following.toString()));

    // Hitung follower count per user
    const userIds = users.map(u => u._id);
    const followerCounts = await Follow.aggregate([
      { $match: { following: { $in: userIds } } },
      { $group: { _id: '$following', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    followerCounts.forEach(f => { countMap[f._id.toString()] = f.count; });

    const result = users.map(u => ({
      ...u,
      isFollowing: followingSet.has(u._id.toString()),
      followersCount: countMap[u._id.toString()] || 0,
    }));

    res.json({
      users: result,
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
};