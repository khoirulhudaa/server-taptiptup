const mongoose = require('mongoose');

const subathonSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  // Timer config (tetap sama)
  mode: { type: String, enum: ['countdown', 'countup'], default: 'countdown' },
  initialSeconds: { type: Number, default: 3600 },
  currentSeconds: { type: Number, default: 3600 },
  
  // **BARU: Kelipatan Durasi Saweria Style**
  autoAddEnabled: { type: Boolean, default: true },
  durationTiers: [{
    amount: { type: Number, required: true },    // Rp 5.000, 10.000, dll
    hours: { type: Number, default: 0 },         // Jam
    minutes: { type: Number, default: 0 },       // Menit  
    seconds: { type: Number, default: 0 }        // Detik
  }],
  
  // Max cap waktu
  maxSeconds: { type: Number, default: null },
  
  // State (tetap sama)
  isRunning: { type: Boolean, default: false },
  startedAt: { type: Date, default: null },
  pausedAt: { type: Date, default: null },
  title: { type: String, default: 'Subathon Timer' },
}, { timestamps: true });

// **BARU: Hitung detik dari tier**
subathonSchema.methods.getTierSeconds = function(amount) {
  if (!this.autoAddEnabled || !this.durationTiers?.length) return 0;
  
  // Cari tier yang cocok (exact match)
  const tier = this.durationTiers.find(t => t.amount === amount);
  if (tier) {
    return (tier.hours * 3600) + (tier.minutes * 60) + tier.seconds;
  }
  
  return 0;
};

module.exports = mongoose.model('Subathon', subathonSchema);