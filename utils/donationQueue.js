// utils/donationQueue.js
const mongoose = require('mongoose');

// ============================================================
// Schema untuk menyimpan queue di MongoDB
// ============================================================
const queueItemSchema = new mongoose.Schema({
  overlayToken:    { type: String, required: true, index: true },
  payload:         { type: Object, required: true },
  displayDuration: { type: Number, default: 8000 },
  status:          { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING' },
  enqueuedAt:      { type: Date, default: Date.now },
  processedAt:     { type: Date },
}, { timestamps: true });

queueItemSchema.index({ overlayToken: 1, status: 1, enqueuedAt: 1 });

const QueueItem = mongoose.models.QueueItem || mongoose.model('QueueItem', queueItemSchema);

// ============================================================
// Queue Manager
// ============================================================
class DonationQueueManager {
  constructor() {
    this.processing = new Map(); // overlayToken → boolean (hanya di memory)
    this._cleanupInterval = setInterval(() => this._cleanup(), 30 * 60 * 1000);
  }

  // ----------------------------------------------------------
  // Tambah donasi ke queue
  // ----------------------------------------------------------
  async enqueue(overlayToken, payload, io, displayDuration = 8000) {
    if (!overlayToken || !io) return;

    try {
      await QueueItem.create({ overlayToken, payload, displayDuration, status: 'PENDING' });

      const queueLength = await QueueItem.countDocuments({
        overlayToken,
        status: { $in: ['PENDING', 'PROCESSING'] },
      });

      console.log(`[Queue] "${payload.donorName}" masuk antrian — posisi: ${queueLength}`);

      if (!this.processing.get(overlayToken)) {
        this._processNext(overlayToken, io);
      }
    } catch (err) {
      console.error('[Queue] ❌ Gagal enqueue:', err.message);
    }
  }

  // ----------------------------------------------------------
  // Proses donasi berikutnya
  // ----------------------------------------------------------
  async _processNext(overlayToken, io) {
    try {
      // Ambil PENDING tertua secara atomic
      const item = await QueueItem.findOneAndUpdate(
        { overlayToken, status: 'PENDING' },
        { $set: { status: 'PROCESSING', processedAt: new Date() } },
        { sort: { enqueuedAt: 1 }, new: true }
      );

      // Tidak ada lagi → berhenti
      if (!item) {
        this.processing.set(overlayToken, false);
        return;
      }

      this.processing.set(overlayToken, true);

      // Cek apakah OBS online
      const room = io.sockets.adapter.rooms.get(overlayToken);
      const clientCount = room ? room.size : 0;

      if (clientCount > 0) {
        io.to(overlayToken).emit('new-donation', item.payload);
        const remaining = await QueueItem.countDocuments({ overlayToken, status: 'PENDING' });
        console.log(`[Queue] ✅ Emit "${item.payload.donorName}" Rp${item.payload.amount} | sisa: ${remaining}`);
      } else {
        console.warn(`[Queue] ⚠️ OBS offline — "${item.payload.donorName}" diskip`);
      }

      // Tandai selesai
      await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });

      // Delay sebelum donasi berikutnya
      const delay = clientCount > 0 ? item.displayDuration + 500 : 100;
      setTimeout(() => this._processNext(overlayToken, io), delay);

    } catch (err) {
      console.error('[Queue] ❌ processNext error:', err.message);
      this.processing.set(overlayToken, false);
    }
  }

  // ----------------------------------------------------------
  // Recovery saat server restart — panggil di server.js
  // ----------------------------------------------------------
  async recover(io) {
    try {
      // Reset yang stuck di PROCESSING karena crash
      const stuck = await QueueItem.updateMany(
        { status: 'PROCESSING' },
        { $set: { status: 'PENDING' } }
      );

      if (stuck.modifiedCount > 0) {
        console.log(`[Queue] 🔄 ${stuck.modifiedCount} item direset PROCESSING → PENDING`);
      }

      // Lanjutkan semua queue yang masih PENDING
      const pendingTokens = await QueueItem.distinct('overlayToken', { status: 'PENDING' });

      if (pendingTokens.length === 0) {
        console.log('[Queue] ✅ Tidak ada queue pending saat startup');
        return;
      }

      console.log(`[Queue] 🔄 Melanjutkan ${pendingTokens.length} queue streamer...`);
      for (const token of pendingTokens) {
        if (!this.processing.get(token)) {
          this._processNext(token, io);
        }
      }
    } catch (err) {
      console.error('[Queue] ❌ Recovery error:', err.message);
    }
  }

  async getQueueLength(overlayToken) {
    return await QueueItem.countDocuments({
      overlayToken,
      status: { $in: ['PENDING', 'PROCESSING'] },
    });
  }

  async _cleanup() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = await QueueItem.deleteMany({
        status: 'DONE',
        processedAt: { $lt: oneHourAgo },
      });
      if (result.deletedCount > 0) {
        console.log(`[Queue] 🧹 ${result.deletedCount} item DONE dihapus`);
      }
    } catch (err) {
      console.error('[Queue] ❌ Cleanup error:', err.message);
    }
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    this.processing.clear();
  }
}

const donationQueue = new DonationQueueManager();

process.on('SIGTERM', () => {
  donationQueue.destroy();
});

module.exports = { donationQueue, QueueItem };