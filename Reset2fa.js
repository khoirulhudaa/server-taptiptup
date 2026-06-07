// reset2FA.js
// Jalankan: node reset2FA.js <email>
// Contoh:   node reset2FA.js user@gmail.com

require('dotenv').config();
const mongoose = require('mongoose');

const email = process.argv[2];

if (!email) {
  console.error('❌ Email wajib diisi!');
  console.error('   Cara pakai: node reset2FA.js user@gmail.com');
  process.exit(1);
}

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI tidak ditemukan di .env');
  process.exit(1);
}

async function reset2FA() {
  try {
    console.log(`\n🔌 Connecting to MongoDB...`);
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected\n`);

    const db = mongoose.connection.db;
    const result = await db.collection('users').updateOne(
      { email },
      { $set: { twoFactorEnabled: false, twoFactorSecret: null } }
    );

    if (result.matchedCount === 0) {
      console.error(`❌ User dengan email "${email}" tidak ditemukan`);
    } else if (result.modifiedCount === 0) {
      console.log(`ℹ️  User ditemukan tapi 2FA sudah dalam kondisi nonaktif`);
    } else {
      console.log(`✅ 2FA berhasil direset untuk: ${email}`);
      console.log(`   twoFactorEnabled → false`);
      console.log(`   twoFactorSecret  → null`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected');
    process.exit(0);
  }
}

reset2FA();