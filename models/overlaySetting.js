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
    },

    activeSlot: {
      type: String,
      enum: ['A', 'B'],
      default: 'A'
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
    progressBarColor: { type: String, default: '#39ff14' },

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

    alertDurationPerThousand:     { type: Number, default: 10 },     // detik per Rp1.000 untuk alert biasa
    mediaShareDurationPerThousand:{ type: Number, default: 15 },    // detik per Rp1.000 untuk Media Share
    
    // ── DURASI ALERT ─────────────────────────────────────
    alertBaseDuration:          { type: Number, default: 10 },   // 10 detik dasar
    alertExtraPerAmount:        { type: Number, default: 10000 }, // setiap Rp10.000
    alertExtraDuration:         { type: Number, default: 5 },    // tambah 5 detik

    // ── DURASI MEDIA SHARE ───────────────────────────────
    mediaShareBaseDuration:     { type: Number, default: 15 },   // 15 detik dasar
    mediaShareExtraPerAmount:   { type: Number, default: 10000 }, // setiap Rp10.000
    mediaShareExtraDuration:    { type: Number, default: 10 },   // tambah 10 detik

    // ── Text-to-Speech ──────────────────────────────────────────────────────
    ttsEnabled: { type: Boolean, default: false },
    ttsRate: { type: Number, default: 1.0 },
    ttsPitch: { type: Number, default: 1.0 },
    ttsVolume: { type: Number, default: 1.0 },
    ttsVoiceName:    { type: String,  default: 'id-ID-GadisNeural' },
    ttsLanguageCode: { type: String,  default: 'id-ID' },
    voiceBaseDuration:   { type: Number, default: 10   },   // detik dasar
    voiceExtraPerAmount: { type: Number, default: 10000 },   // per Rp10.000
    voiceExtraDuration:  { type: Number, default: 5     },   // +5 detik

    storeProducts: [{
      name: String,
      price: Number,
      imageUrl: String,
      link: String,
      description: String
    }],
    slot: { type: String, enum: ['A', 'B'], default: 'A' },
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

overlaySettingSchema.methods.getVoiceDuration = function (amount) {
  if (!amount || amount <= 0) return 10000;
  const base     = Number(this.voiceBaseDuration)     || 10;
  const perAmt   = Number(this.voiceExtraPerAmount)   || 10000;
  const extraDur = Number(this.voiceExtraDuration)    || 5;
  const extras   = perAmt > 0 ? Math.floor(amount / perAmt) : 0;
  return (base + extras * extraDur) * 1000; // ms
};

overlaySettingSchema.methods.getAlertDuration = function (amount) {
  if (!amount || amount <= 0) return 10000;

  // PRIORITAS PERTAMA: durationTiers
  if (this.durationTiers?.length > 0) {
    const sorted = [...this.durationTiers].sort((a, b) => b.minAmount - a.minAmount);
    for (const tier of sorted) {
      if (amount >= tier.minAmount && (tier.maxAmount === null || amount <= tier.maxAmount)) {
        return tier.duration * 1000;
      }
    }
  }

  // PRIORITAS KEDUA: alertBaseDuration + extra
  if (this.alertBaseDuration != null) {
    const base     = Number(this.alertBaseDuration)   || 10;
    const perAmt   = Number(this.alertExtraPerAmount)  || 10000;
    const extraDur = Number(this.alertExtraDuration)   || 5;
    const extras   = perAmt > 0 ? Math.floor(amount / perAmt) : 0;
    return (base + extras * extraDur) * 1000;
  }

  return 10000;
};

overlaySettingSchema.methods.getMediaShareDuration = function (amount) {
  if (!amount || amount <= 0) return 15000;

  // ✅ Gunakan pengaturan baru
  const base = this.mediaShareBaseDuration ?? 15;
  const perAmount = this.mediaShareExtraPerAmount ?? 10000;
  const extraDur = this.mediaShareExtraDuration ?? 10;

  if (perAmount > 0) {
    const extras = Math.floor(amount / perAmount);
    const totalSeconds = base + (extras * extraDur);
    return totalSeconds * 1000;
  }

  return base * 1000;
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

overlaySettingSchema.index({ userId: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model('OverlaySetting', overlaySettingSchema);