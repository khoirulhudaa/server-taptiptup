// models/user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Format email tidak valid'],
    },
    password: {
      type: String,
      required: true,
    },
    walletBalance: {
      type: Number,
      default: 0,
    },
    overlayToken: {
      type: String,
      unique: true,
    },
    role: {
      type: String,
      enum: ['user', 'superAdmin'],
      default: 'user',
    },
      totalDonations: {      // Total donasi diterima
      type: Number, 
      default: 0,
    },
    totalDonationCount: {  // Total jumlah donasi diterima
      type: Number, 
      default: 0,
    },
    donationMilestones: {  // Badge milestone
      type: Map,
      of: Boolean,
      default: {},
    },
    donorMilestones: {     // Badge donor
      type: Map,
      of: Boolean,
      default: {},
    },
    // ── SOCIAL MEDIA ─────────────────────────────────────
    instagram:  { type: String, default: '' },
    facebook:   { type: String, default: '' },
    youtube:    { type: String, default: '' },
    twitter:    { type: String, default: '' },   // atau xUsername
    bio: { type: String, default: '' },
  },
  { timestamps: true }
);

// ─── Hash password sebelum disimpan ───────────────────────────────────────────
userSchema.pre('save', async function () {
  // Hanya hash jika field password berubah
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Method validasi password ─────────────────────────────────────────────────
userSchema.methods.validPassword = function (password) {
  return bcrypt.compareSync(password, this.password);
};

module.exports = mongoose.model('User', userSchema);