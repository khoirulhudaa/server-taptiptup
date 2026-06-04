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
      console.log(`[Queue] "${payload.donorName}" masuk antrian`);
      if (!this.processing.get(overlayToken)) {
        this._processNext(overlayToken, io);
      }
    } catch (err) {
      console.error('[Queue] ❌ Gagal enqueue:', err.message);
    }
  }

  // async _processNext(overlayToken, io) {
  //   // ✅ OPTIMASI: Guard flag untuk cegah race condition
  //   if (this.processing.get(overlayToken) === 'running') return;
  //   this.processing.set(overlayToken, 'running');

  //   try {
  //     // 1. Ambil item PENDING pertama (FIFO)
  //     const item = await QueueItem.findOneAndUpdate(
  //       { overlayToken, status: 'PENDING' },
  //       { $set: { status: 'PROCESSING', processedAt: new Date() } },
  //       { 
  //         sort: { enqueuedAt: 1 }, // FIFO
  //         returnDocument: 'after' 
  //       }
  //     );

  //     if (!item) {
  //       // ✅ No more pending → stop processing
  //       this.processing.set(overlayToken, false);
  //       return;
  //     }

  //     // // 2. Mark as processing
  //     // this.processing.set(overlayToken, true);

  //     // 3. Prepare payload
  //     const payload = {
  //       ...item.payload,
  //       isReplay: item.payload.isReplay || false,
  //       // queuePosition: await this.getQueueLength(overlayToken),
  //     };

  //     console.log(`[Queue] 🔄 PROCESSING "${payload.donorName}" | Replay: ${payload.isReplay} | Media: ${!!payload.mediaUrl}`);

  //     // 4. Emit ke room yang tepat
  //     // ✅ OPTIMASI: Jalankan emit + mark DONE secara paralel untuk voice-only
  //     if (payload.voiceUrl && !payload.mediaUrl) {
  //       // Voice-only: langsung DONE, tidak perlu tunggu displayDuration
  //       await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });
  //       console.log(`[Queue] 🎙️ Voice-only skip`);

  //       // ✅ OPTIMASI: Hapus delay 500ms — langsung proses berikutnya
  //       this.processing.set(overlayToken, false);
  //       setImmediate(() => this._processNext(overlayToken, io));
  //       return;

  //     } else if (payload.mediaUrl && payload.isMediaShare) {
  //       console.log(`[Queue] 🎬 MediaShare → "${payload.donorName}" | URL: ${payload.mediaUrl}`);
  //       io.to(`${overlayToken}-mediashare`).emit('new-media-donation', payload);

  //     } else {
  //       io.to(overlayToken).emit('new-donation', payload);
  //       console.log(`[Queue] 💜 OverlayAlert → "${payload.donorName}"`);
  //     }

  //     // 5. Mark as DONE
  //     // ✅ OPTIMASI: Mark DONE tanpa await bloking — fire and forget
  //     QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } }).catch(err =>
  //       console.error('[Queue] ❌ Gagal mark DONE:', err.message)
  //     );

  //     // ✅ OPTIMASI: Kurangi buffer dari 500ms → 100ms
  //     const nextDelay = item.displayDuration + 100;
      
  //     this.processing.set(overlayToken, false);
  //     setTimeout(() => this._processNext(overlayToken, io), nextDelay);

  //   } catch (err) {
  //     console.error('[Queue] ❌ _processNext ERROR:', err.message);
  //     this.processing.set(overlayToken, false);

  //     // ✅ OPTIMASI: Kurangi retry dari 5000ms → 2000ms
  //     setTimeout(() => {
  //       if (!this.processing.get(overlayToken)) {
  //         this._processNext(overlayToken, io);
  //       }
  //     }, 2000);
  //   }
  // }

  async _processNext(overlayToken, io) {
    if (this.processing.get(overlayToken) === 'running') return;
    this.processing.set(overlayToken, 'running');

    try {
      const item = await QueueItem.findOneAndUpdate(
        { overlayToken, status: 'PENDING' },
        { $set: { status: 'PROCESSING', processedAt: new Date() } },
        { sort: { enqueuedAt: 1 }, returnDocument: 'after' }
      );

      if (!item) {
        this.processing.set(overlayToken, false);
        return;
      }

      const payload = {
        ...item.payload,
        isReplay: item.payload.isReplay || false,
      };

      console.log(`[Queue] 🔄 PROCESSING "${payload.donorName}" | Voice: ${!!payload.voiceUrl} | Media: ${!!payload.mediaUrl}`);

      // ==================== VOICE NOTE ====================
      if (payload.voiceUrl && !payload.mediaUrl) {
        console.log(`[Queue] 🎙️ Emitting Voice Note to ${overlayToken}-voice`);
        io.to(`${overlayToken}-voice`).emit('new-voice-donation', payload);
      } 
      // ==================== MEDIA SHARE ====================
      else if (payload.mediaUrl && payload.isMediaShare) {
        console.log(`[Queue] 🎬 Emitting MediaShare to ${overlayToken}-mediashare`);
        io.to(`${overlayToken}-mediashare`).emit('new-media-donation', payload);
      } 
      // ==================== NORMAL ALERT ====================
      else {
        console.log(`[Queue] 💜 Emitting Normal Alert to ${overlayToken}`);
        io.to(overlayToken).emit('new-donation', payload);
      }

      // Mark as DONE
      await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });

      const nextDelay = item.displayDuration + 100;

      this.processing.set(overlayToken, false);
      setTimeout(() => this._processNext(overlayToken, io), nextDelay);

    } catch (err) {
      console.error('[Queue] ❌ _processNext ERROR:', err.message);
      this.processing.set(overlayToken, false);
      setTimeout(() => this._processNext(overlayToken, io), 2000);
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

      // ✅ OPTIMASI: Jalankan semua recovery paralel, bukan satu-satu
      await Promise.all(
        pendingTokens.map(token => {
          if (!this.processing.get(token)) {
            return this._processNext(token, io);
          }
        })
      );
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
process.on('SIGTERM', () => donationQueue.destroy());

module.exports = { donationQueue, QueueItem };