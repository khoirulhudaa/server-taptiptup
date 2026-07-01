// models/donation.js — VERSI FINAL
const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    externalId: {
      type: String,
      unique: true,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    donorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isMediaShare: { type: Boolean, default: false },
    songData: {
      title: String,
      artist: String,
      artworkUrl: String,
      videoId: String,        // ← ganti duration + permalinkUrl
      permalinkUrl: String,   // ← tetap ada (isi dengan youtube URL)
      duration: Number,
    },
    donorName: {
      type: String,
      default: 'Anonim',
    },
    amount: {
      type: Number,
      required: true,
    },
    message: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'EXPIRED'],
      default: 'PENDING',
    },

    donorIp: {
      type: String,
      default: null,
    },
    
    donationItem: {
      name:        { type: String },
      emoji:       { type: String },
      price:       { type: Number },
      quantity:    { type: Number, default: 1 },  // ← TAMBAH INI
      description: { type: String },
    },

    donorGifChoice: { type: String, default: null }, // path gif pilihan donor

    // ── Fee tracking ──────────────────────────────────────────
    grossAmount:     { type: Number, default: null },
    streamerReceive: { type: Number, default: null }, // amount setelah 2.5% dipotong
    feeBearer:       { type: String, enum: ['streamer', 'donor'], default: null },
    percentFee:      { type: Number, default: null },

    // ── Available balance tracking ────────────────────────────
    // availableAt: kapan donasi ini bisa ditarik (createdAt + 24 jam)
    // diset oleh webhook saat donasi PAID
    availableAt: { type: Date, default: null },

    // isAvailable: apakah sudah masuk ke availableBalance user
    // diset true oleh cron setelah availableAt terlewati
    isAvailable: { type: Boolean, default: false },
    videoBlocked: { type: Boolean, default: false },
    blockReason:  { type: String, default: null },
    // ── Media & misc ──────────────────────────────────────────
    startTime: { type: Number, default: 0 },
    voiceUrl:  { type: String, default: null },
    mediaUrl:  { type: String, default: null },
    mediaType: { type: String, enum: ['image', 'video', 'youtube', null], default: null },
    soundUrl:  { type: String, default: null },
    paymentUrl: String,

    pollVote: {
      pollId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Poll', default: null },
      optionId: { type: String, default: null },
    },
  },
  { timestamps: true }
);

// Indexes
donationSchema.index({ userId: 1, createdAt: -1 });
donationSchema.index({ donorUserId: 1, createdAt: -1 });
donationSchema.index({ status: 1 });
donationSchema.index({ donorUserId: 1, userId: 1 });
// Index penting untuk cron
donationSchema.index({ status: 1, isAvailable: 1, availableAt: 1 });

module.exports = mongoose.model('Donation', donationSchema);