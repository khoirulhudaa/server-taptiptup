// migrate-security-pin.js
const mongoose = require('mongoose');
const { User } = require('./models'); // ← Sesuaikan path dengan model kamu
require('dotenv').config();

async function addSecurityPinToExistingUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Terhubung ke MongoDB');

    const result = await User.updateMany(
      { securityPin: { $exists: false } },   // user yang belum punya field securityPin
      { $set: { securityPin: '0000' } }      // kasih default PIN 0000
    );

    console.log(`🎉 Berhasil! ${result.modifiedCount} user telah ditambahkan field securityPin`);
    
  } catch (err) {
    console.error('❌ Error saat migrasi:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnect dari MongoDB');
  }
}

// Jalankan
addSecurityPinToExistingUsers();