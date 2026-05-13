// // utils/donationQueue.js
// const mongoose = require('mongoose');

// // ============================================================
// // Schema untuk menyimpan queue di MongoDB
// // ============================================================
// const queueItemSchema = new mongoose.Schema({
//   overlayToken:    { type: String, required: true, index: true },
//   payload:         { type: Object, required: true },
//   displayDuration: { type: Number, default: 8000 },
//   status:          { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING' },
//   enqueuedAt:      { type: Date, default: Date.now },
//   processedAt:     { type: Date },
// }, { timestamps: true });

// queueItemSchema.index({ overlayToken: 1, status: 1, enqueuedAt: 1 });

// const QueueItem = mongoose.model('QueueItem', queueItemSchema);

// // ============================================================
// // Queue Manager
// // ============================================================
// class DonationQueueManager {
//   constructor() {
//     this.processing = new Map(); // overlayToken → boolean (hanya di memory)
//     this._cleanupInterval = setInterval(() => this._cleanup(), 30 * 60 * 1000);
//   }

//   // ----------------------------------------------------------
//   // Tambah donasi ke queue
//   // ----------------------------------------------------------
//   async enqueue(overlayToken, payload, io, displayDuration = 8000) {
//     if (!overlayToken || !io) return;

//     try {
//       await QueueItem.create({ overlayToken, payload, displayDuration, status: 'PENDING' });

//       const queueLength = await QueueItem.countDocuments({
//         overlayToken,
//         status: { $in: ['PENDING', 'PROCESSING'] },
//       });

//       console.log(`[Porifile donatur] "${payload}"`);
//       console.log(`[Queue] "${payload.donorName}" masuk antrian — posisi: ${queueLength}`);

//       if (!this.processing.get(overlayToken)) {
//         this._processNext(overlayToken, io);
//       }
//     } catch (err) {
//       console.error('[Queue] ❌ Gagal enqueue:', err.message);
//     }
//   }

//   // ----------------------------------------------------------
//   // Proses donasi berikutnya
//   // ----------------------------------------------------------
//   async _processNext(overlayToken, io) {
//     try {
//         const item = await QueueItem.findOneAndUpdate(
//         { overlayToken, status: 'PENDING' },
//         { $set: { status: 'PROCESSING', processedAt: new Date() } },
//         { sort: { enqueuedAt: 1 }, returnDocument: 'after' }  // ← fix deprecation
//         );

//         if (!item) {
//         this.processing.set(overlayToken, false);
//         return;
//         }

//         this.processing.set(overlayToken, true);

//         // ✅ Selalu emit — jangan skip meskipun OBS offline
//         // Socket.IO akan buffer kalau pakai Redis adapter, dan overlay akan
//         // langsung terima saat reconnect lewat "join-room" event
//         io.to(overlayToken).emit('new-donation', item.payload);

//         const remaining = await QueueItem.countDocuments({ overlayToken, status: 'PENDING' });
//         console.log(`[Queue] ✅ Emit "${item.payload.donorName}" Rp${item.payload.amount} | sisa: ${remaining}`);

//         await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });

//         // Delay ke donasi berikutnya
//         setTimeout(() => this._processNext(overlayToken, io), item.displayDuration + 500);

//     } catch (err) {
//         console.error('[Queue] ❌ processNext error:', err.message);
//         this.processing.set(overlayToken, false);
//     }
//     }

//   // ----------------------------------------------------------
//   // Recovery saat server restart — panggil di server.js
//   // ----------------------------------------------------------
//     async recover(io) {
//     try {
//         const stuck = await QueueItem.updateMany(
//         { status: 'PROCESSING' },
//         { $set: { status: 'PENDING' } }
//         );

//       if (stuck.modifiedCount > 0) {
//         console.log(`[Queue] 🔄 ${stuck.modifiedCount} item direset PROCESSING → PENDING`);
//       }

//       // Lanjutkan semua queue yang masih PENDING
//       const pendingTokens = await QueueItem.distinct('overlayToken', { status: 'PENDING' });

//       if (pendingTokens.length === 0) {
//         console.log('[Queue] ✅ Tidak ada queue pending saat startup');
//         return;
//       }

//       console.log(`[Queue] 🔄 Melanjutkan ${pendingTokens.length} queue streamer...`);
//       for (const token of pendingTokens) {
//         if (!this.processing.get(token)) {
//           this._processNext(token, io);
//         }
//       }
//     } catch (err) {
//       console.error('[Queue] ❌ Recovery error:', err.message);
//     }
//   }

//   async getQueueLength(overlayToken) {
//     return await QueueItem.countDocuments({
//       overlayToken,
//       status: { $in: ['PENDING', 'PROCESSING'] },
//     });
//   }

//   async _cleanup() {
//     try {
//       const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
//       const result = await QueueItem.deleteMany({
//         status: 'DONE',
//         processedAt: { $lt: oneHourAgo },
//       });
//       if (result.deletedCount > 0) {
//         console.log(`[Queue] 🧹 ${result.deletedCount} item DONE dihapus`);
//       }
//     } catch (err) {
//       console.error('[Queue] ❌ Cleanup error:', err.message);
//     }
//   }

//   destroy() {
//     clearInterval(this._cleanupInterval);
//     this.processing.clear();
//   }
// }

// const donationQueue = new DonationQueueManager();

// process.on('SIGTERM', () => {
//   donationQueue.destroy();
// });

// module.exports = { donationQueue, QueueItem };


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
        this._processNext(overlayToken, io);
      }
    } catch (err) {
      console.error('[Queue] ❌ Gagal enqueue:', err.message);
    }
  }

  async _processNext(overlayToken, io) {
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

      this.processing.set(overlayToken, true);
      console.log('items', item.payload)
      // ── Emit new-media-donation ke MediaShareOverlay (hanya kalau ada media) ──
      if (item.payload.mediaUrl !== '' || item.payload.mediaUrl !== null) {
        io.to(overlayToken).emit('new-media-donation', item.payload);
        console.log(`[Queue] 🎬 Emit new-media-donation "${item.payload.donorName}"`);
      }

      // ── Emit new-donation ke OverlayAlert (selalu) ──
      io.to(overlayToken).emit('new-donation', item.payload);

      const remaining = await QueueItem.countDocuments({ overlayToken, status: 'PENDING' });
      console.log(`[Queue] ✅ Emit "${item.payload.donorName}" Rp${item.payload.amount} | sisa: ${remaining}`);

      await QueueItem.findByIdAndUpdate(item._id, { $set: { status: 'DONE' } });

      setTimeout(() => this._processNext(overlayToken, io), item.displayDuration + 500);

    } catch (err) {
      console.error('[Queue] ❌ processNext error:', err.message);
      this.processing.set(overlayToken, false);
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