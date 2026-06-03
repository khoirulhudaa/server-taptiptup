const mongoose = require('mongoose');
const { OverlaySetting } = require('./models'); // pastikan path benar
require('dotenv').config();

async function migrateOverlaySettings() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Terhubung ke MongoDB');

    // 1. Pindahkan semua document yang belum punya field slot ke slot 'A'
    const result1 = await OverlaySetting.updateMany(
      { slot: { $exists: false } },           // belum punya slot
      { $set: { slot: 'A' } }
    );

    console.log(`📌 Document tanpa slot → diubah ke 'A': ${result1.modifiedCount} data`);

    // 2. Perbaiki document yang slotnya rusak ([OBJECT OBJECT])
    const result2 = await OverlaySetting.updateMany(
      { slot: "[OBJECT OBJECT]" },
      { $set: { slot: 'A' } }
    );

    console.log(`📌 Document dengan slot rusak → diubah ke 'A': ${result2.modifiedCount} data`);

    // 3. (Opsional) Hapus duplikat jika ada lebih dari 1 document dengan userId + slot yang sama
    // Ini lebih aman dilakukan manual via Compass jika diperlukan

    // Cek hasil akhir
    const stats = await OverlaySetting.aggregate([
      {
        $group: {
          _id: { userId: "$userId", slot: "$slot" },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    if (stats.length > 0) {
      console.log("⚠️ Masih ada duplikat:", stats);
    } else {
      console.log("✅ Tidak ada duplikat userId + slot");
    }

    console.log('🎉 Migrasi selesai!');
  } catch (err) {
    console.error('❌ Error migrasi:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnect dari MongoDB');
  }
}

migrateOverlaySettings();