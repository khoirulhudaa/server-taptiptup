// utils/donationQueue.js
const mongoose = require('mongoose');

const queueItemSchema = new mongoose.Schema({
  overlayToken:    { type: String, required: true, index: true },
  payload:         { type: Object, required: true },
  displayDuration: { type: Number, default: 8000 },
  status:          { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING' },
  enqueuedAt:      { type: Date, default: Date.now },
  processedAt:     { type: Date },
}, { timestamps: true });

queueItemSchema.index({ overlayToken: 1, status: 1, enqueuedAt: 1 });

const QueueItem = mongoose.model('QueueItem', queueItemSchema);

class DonationQueueManager {
  constructor() {
    this.processing = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), 30 * 60 * 1000);
  }

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
        // ✅ Tambah delay kecil agar tidak langsung emit
        setTimeout(() => this._processNext(overlayToken, io), 300);
      }
    } catch (err) {
      console.error('[Queue] ❌ Gagal enqueue:', err.message);
    }
  }

  async _processNext(overlayToken, io) {
    try {
      // 1. Ambil item PENDING pertama (FIFO)
      const item = await QueueItem.findOneAndUpdate(
        { overlayToken, status: 'PENDING' },
        { $set: { status: 'PROCESSING', processedAt: new Date() } },
        { 
          sort: { enqueuedAt: 1 }, // FIFO
          returnDocument: 'after' 
        }
      );

      if (!item) {
        // ✅ No more pending → stop processing
        this.processing.set(overlayToken, false);
        return;
      }

      // 2. Mark as processing
      this.processing.set(overlayToken, true);

      // 3. Prepare payload
      const payload = {
        ...item.payload,
        isReplay: item.payload.isReplay || false,
        queuePosition: await this.getQueueLength(overlayToken),
      };

      console.log(`[Queue] 🔄 PROCESSING "${payload.donorName}" | Replay: ${payload.isReplay} | Media: ${!!payload.mediaUrl}`);

      // 4. Emit ke room yang tepat
      if (payload.voiceUrl && !payload.mediaUrl) {
        // Voice-only → skip (sudah di-emit langsung di webhook)
        await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });
        const remaining = await QueueItem.countDocuments({ overlayToken, status: 'PENDING' });
        console.log(`[Queue] 🎙️ Voice-only skip | Sisa: ${remaining}`);
        setTimeout(() => this._processNext(overlayToken, io), 500);
        return;

      } else if (payload.mediaUrl && payload.isMediaShare) {
        // ← isMediaShare harus true
        console.log(`[Queue] 🎬 MediaShare → "${payload.donorName}" | URL: ${payload.mediaUrl}`);
        io.to(`${overlayToken}-mediashare`).emit('new-media-donation', payload);

      } else {
        // Regular alert
        io.to(overlayToken).emit('new-donation', payload);
        console.log(`[Queue] 💜 OverlayAlert → "${payload.donorName}"`);
      }

      // 5. Mark as DONE
      await QueueItem.findByIdAndUpdate(
        item._id, 
        { $set: { status: 'DONE' } }
      );

      // 6. Hitung sisa queue
      const remaining = await QueueItem.countDocuments({ 
        overlayToken, 
        status: 'PENDING' 
      });
      console.log(`[Queue] ✅ "${payload.donorName}" DONE | Sisa: ${remaining}`);

      // 7. Schedule next item
      const nextDelay = item.displayDuration + 500; // +500ms buffer
      setTimeout(() => this._processNext(overlayToken, io), nextDelay);

    } catch (err) {
      console.error('[Queue] ❌ _processNext ERROR:', err.message);
      
      // ✅ Reset processing state on error
      this.processing.set(overlayToken, false);
      
      // ✅ Optional: retry after 5s
      setTimeout(() => {
        if (!this.processing.get(overlayToken)) {
          console.log(`[Queue] 🔄 Retry ${overlayToken} in 5s...`);
          this._processNext(overlayToken, io);
        }
      }, 5000);
    }
  }

  async recover(io) {
    try {
      const stuck = await QueueItem.updateMany(
        { status: 'PROCESSING' },
        { $set: { status: 'PENDING' } }
      );

      if (stuck.modifiedCount > 0) {
        console.log(`[Queue] 🔄 ${stuck.modifiedCount} item direset PROCESSING → PENDING`);
      }

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