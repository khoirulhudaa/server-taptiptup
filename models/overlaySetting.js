const mongoose = require('mongoose');

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const durationTierSchema = new mongoose.Schema(
  {
    minAmount: { type: Number, required: true },
    maxAmount: { type: Number, default: null },
    duration:  { type: Number, required: true },
  },
  { _id: false }
);

const mediaTriggerSchema = new mongoose.Schema(
  {
    minAmount: { type: Number, required: true },
    mediaType: {
      type: String,
      enum: ['image', 'video', 'both'],
      default: 'both',
    },
    label: { type: String, default: '' },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const overlaySettingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── Donasi ──────────────────────────────────────────────────────────────
    minDonate: { type: Number, default: 10000 },
    maxDonate: { type: Number, default: 10000000 },

    // ── Overlay Toggle ───────────────────────────────────────────────────────
    // Jika false, alert TIDAK ditampilkan di OBS meskipun donasi masuk
    overlayEnabled: { type: Boolean, default: true },

    // ── Custom Icon ──────────────────────────────────────────────────────────
    // Bisa berisi emoji (contoh: "🔥", "⭐", "🎮") atau URL gambar
    // Jika kosong / null, fallback ke default emoji "💜"
    customIcon: { type: String, default: '' },

    // ── Show Timestamp ───────────────────────────────────────────────────────
    // Jika true, tampilkan jam:menit:detik kapan donasi diterima di overlay
    showTimestamp: { type: Boolean, default: true },

    // ── Tampilan alert ──────────────────────────────────────────────────────
    theme:           { type: String, default: 'modern' },
    primaryColor:    { type: String, default: '#6366f1' },
    textColor:       { type: String, default: '#ffffff' },
    animation:       { type: String, default: 'bounce' },
    maxWidth:        { type: Number, default: 280 },
    overlayPosition: { type: String, default: 'bottom-right' },

    // ── Durasi (legacy) ────────────────────────────────────────────────────
    baseDuration:   { type: Number, default: 5 },
    extraPerAmount: { type: Number, default: 10000 },
    extraDuration:  { type: Number, default: 1 },

    // ── Durasi bertingkat ───────────────────────────────────────────────────
    durationTiers: { type: [durationTierSchema], default: [] },

    // ── Media Triggers ───────────────────────────────────────────────────────
    mediaTriggers: { type: [mediaTriggerSchema], default: [] },

    // ── Misc ────────────────────────────────────────────────────────────────
    soundUrl:  String,
    customCss: String,
  },
  { timestamps: true }
);

// ─── Instance Methods ─────────────────────────────────────────────────────────

overlaySettingSchema.methods.getDuration = function (amount) {
  if (this.durationTiers && this.durationTiers.length > 0) {
    const sorted = [...this.durationTiers].sort((a, b) => b.minAmount - a.minAmount);
    for (const tier of sorted) {
      if (
        amount >= tier.minAmount &&
        (tier.maxAmount === null || amount <= tier.maxAmount)
      ) {
        return tier.duration;
      }
    }
  }
  const extras = Math.floor(amount / this.extraPerAmount);
  return this.baseDuration + extras * this.extraDuration;
};

overlaySettingSchema.methods.getMediaTriggerForAmount = function (amount) {
  if (!this.mediaTriggers || this.mediaTriggers.length === 0) return null;
  const eligible = this.mediaTriggers
    .filter((t) => amount >= t.minAmount)
    .sort((a, b) => b.minAmount - a.minAmount);
  return eligible[0] || null;
};

module.exports = mongoose.model('OverlaySetting', overlaySettingSchema);