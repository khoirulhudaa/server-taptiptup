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

const soundTierSchema = new mongoose.Schema({
  minAmount: { type: Number, required: true },
  maxAmount: { type: Number, default: null },
  soundUrl:  { type: String, required: true },
  label:     { type: String, default: '' },
}, { _id: false });

// ─── Main Schema ──────────────────────────────────────────────────────────────

const overlaySettingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── FEE CONFIGURATION (BARU) ─────────────────────────────────────────────
    feeBearer: {
      type: String,
      enum: ['streamer', 'donor'],
      default: 'streamer'   // default: streamer yang tanggung 2.5%
    },

    // ── Donasi ──────────────────────────────────────────────────────────────
    minDonate: { type: Number, default: 10000 },
    maxDonate: { type: Number, default: 10000000 },

    // ── Overlay Toggle ───────────────────────────────────────────────────────
    overlayEnabled: { type: Boolean, default: true },

    // ── Custom Icon ──────────────────────────────────────────────────────────
    customIcon: { type: String, default: '' },

    // ── Show Timestamp ───────────────────────────────────────────────────────
    showTimestamp: { type: Boolean, default: true },

    // ── Tampilan alert ──────────────────────────────────────────────────────
    theme:           { type: String, default: 'modern' },
    primaryColor:    { type: String, default: '#6366f1' },
    textColor:       { type: String, default: '#ffffff' },
    highlightColor:  { type: String, default: '#a5b4fc' },
    animation:       { type: String, default: 'bounce' },
    borderColor:     { type: String, default: '#ffffff26' }, 
    maxWidth:        { type: Number, default: 280 },
    overlayPosition: { type: String, default: 'bottom-right' },

    // ── Durasi ──────────────────────────────────────────────────────────────
    baseDuration:   { type: Number, default: 5 },
    extraPerAmount: { type: Number, default: 10000 },
    extraDuration:  { type: Number, default: 1 },

    durationTiers: { type: [durationTierSchema], default: [] },

    // ── Media & Sound ───────────────────────────────────────────────────────
    mediaTriggers: { type: [mediaTriggerSchema], default: [] },
    soundTiers: { type: [soundTierSchema], default: [] },
    publicSounds: [{
      url: String,
      label: String,
      emoji: String
    }],
    publicSoundDefault: String, 

    // ── Misc ────────────────────────────────────────────────────────────────
    soundUrl:  String,
    customCss: String,

    leaderboardShowAmount: { type: Boolean, default: true },
    leaderboardLimit:      { type: Number, default: 10 },
    leaderboardPeriod:     { type: String, enum: ['alltime', 'today'], default: 'alltime' },

    quickAmounts: {
      type: [Number],
      default: [10000, 25000, 50000, 100000, 250000]
    },

    // ── Text-to-Speech ──────────────────────────────────────────────────────
    ttsEnabled: { type: Boolean, default: false },
    ttsRate: { type: Number, default: 1.0 },
    ttsPitch: { type: Number, default: 1.0 },
    ttsVolume: { type: Number, default: 1.0 },
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

overlaySettingSchema.methods.getSoundForAmount = function (amount) {
  if (!this.soundTiers || this.soundTiers.length === 0) return this.soundUrl || null;
  const sorted = [...this.soundTiers].sort((a, b) => b.minAmount - a.minAmount);
  for (const tier of sorted) {
    if (amount >= tier.minAmount && (tier.maxAmount === null || amount <= tier.maxAmount)) {
      return tier.soundUrl;
    }
  }
  return this.soundUrl || null;
};

module.exports = mongoose.model('OverlaySetting', overlaySettingSchema);