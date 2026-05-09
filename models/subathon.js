const mongoose = require('mongoose');

const subathonSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  // Timer config
  mode: { type: String, enum: ['countdown', 'countup'], default: 'countdown' },
  initialSeconds: { type: Number, default: 3600 }, // 1 jam default
  currentSeconds: { type: Number, default: 3600 },
  
  // Auto-add waktu saat donasi masuk
  autoAddEnabled: { type: Boolean, default: true },
  addSecondsPerAmount: { type: Number, default: 60 },  // +60 detik per Rp 10.000
  addPerAmount: { type: Number, default: 10000 },       // per berapa rupiah
  
  // Max cap waktu (opsional)
  maxSeconds: { type: Number, default: null },
  
  // State
  isRunning: { type: Boolean, default: false },
  startedAt: { type: Date, default: null },
  pausedAt: { type: Date, default: null },
  
  // Label OBS
  title: { type: String, default: 'Subathon Timer' },
}, { timestamps: true });

// Hitung berapa detik yang harus ditambah untuk amount tertentu
subathonSchema.methods.calcAddSeconds = function(amount) {
  if (!this.autoAddEnabled) return 0;
  const units = Math.floor(amount / this.addPerAmount);
  return units * this.addSecondsPerAmount;
};

module.exports = mongoose.model('Subathon', subathonSchema);