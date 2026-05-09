// models/follow.js
const mongoose = require('mongoose');

const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Pastikan tidak bisa follow orang yang sama dua kali
followSchema.index({ follower: 1, following: 1 }, { unique: true });

module.exports = mongoose.model('Follow', followSchema);