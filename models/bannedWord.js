const mongoose = require('mongoose');
const bannedWordSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  words:   { type: [String], default: [] },
  action:  { 
    type: String, 
    enum: ['block', 'censor', 'replace'], 
    default: 'block' 
  },
  replacement: { type: String, default: '' }, // dipakai jika action === 'replace'
}, { timestamps: true });
bannedWordSchema.index({ userId: 1 }, { unique: true });
module.exports = mongoose.model('BannedWord', bannedWordSchema);