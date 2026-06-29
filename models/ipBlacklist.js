// models/IpBlacklist.js
const mongoose = require('mongoose');

const ipBlacklistSchema = new mongoose.Schema(
  {
    // Pemilik blacklist (streamer yang memblokir)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // IP yang diblokir
    ip: {
      type: String,
      required: true,
      trim: true,
    },

    // Catatan opsional dari streamer
    reason: {
      type: String,
      default: '',
      maxlength: 200,
    },

    // Referensi ke donasi yang memicu pemblokiran (opsional)
    donationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Donation',
      default: null,
    },

    // Nama donor saat diblokir (untuk referensi cepat)
    donorName: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Satu IP tidak boleh dobel untuk streamer yang sama
ipBlacklistSchema.index({ userId: 1, ip: 1 }, { unique: true });

module.exports = mongoose.model('IpBlacklist', ipBlacklistSchema);