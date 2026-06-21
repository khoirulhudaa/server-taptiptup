// models/withdrawal.js
const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: String,
    channelCode: String,
    accountNumber: String,
    accountName: String,
    idempotencyKey: {
      type: String,
      unique: true,   // ← index unique mencegah duplikat di level DB
      sparse: true,   // ← sparse agar dokumen lama (tanpa field ini) tidak error
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    midtransReference: String,
    note: {
      type: String,
      default: null, // alasan reject dari admin (opsional)
    },
    dokuTransferId: { type: String, default: null },
    dokuStatus: { type: String, default: null },
  },
  { timestamps: true }
);

withdrawalSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
withdrawalSchema.index({ userId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);