
// models/donation.js
const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
  {
    externalId: {
      type: String,
      unique: true, // order_id dari Midtrans
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    donorUserId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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
    // Field baru: kapan donasi ini available untuk ditarik
    availableAt: { type: Date, default: null },  // null = belum available
    startTime: { type: Number, default: 0 },
    voiceUrl: { type: String, default: null },
    mediaUrl:  { type: String, default: null },
    mediaType: { type: String, enum: ['image', 'video', 'youtube'], default: 'image' },
    grossAmount: { type: Number },
    streamerReceive: { type: Number },
    feeBearer: { type: String, enum: ['streamer', 'donor'] },
    percentFee: { type: Number },
    paymentUrl: String, // Snap redirect_url
  },
  { timestamps: true }
);

donationSchema.index({ userId: 1, createdAt: -1 });
donationSchema.index({ donorUserId: 1, createdAt: -1 });
donationSchema.index({ status: 1 });
donationSchema.index({ donorUserId: 1, userId: 1 });
donationSchema.index({ streamerUsername: 1, status: 1 });

module.exports = mongoose.model('Donation', donationSchema);