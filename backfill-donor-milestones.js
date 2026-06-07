// scripts/backfill-donor-milestones.js
// Jalankan sekali: node scripts/backfill-donor-milestones.js

require('dotenv').config();
const mongoose = require('mongoose');
const { Donation, User } = require('./models');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function backfillDonorMilestones() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Ambil semua donasi PAID yang punya donorUserId
  const pipeline = [
    {
      $match: {
        status: 'PAID',
        donorUserId: { $exists: true, $ne: null },
      }
    },
    {
      $group: {
        _id: '$donorUserId',
        totalAmount: { $sum: '$amount' },
        totalCount:  { $sum: 1 },
      }
    }
  ];

  const results = await Donation.aggregate(pipeline);
  console.log(`📦 Ditemukan ${results.length} donor unik dengan donasi PAID\n`);

  let updated = 0;
  let skipped = 0;

  for (const donor of results) {
    const { _id: donorUserId, totalAmount, totalCount } = donor;

    const milestoneUpdates = {};

    // Badge berdasarkan jumlah donasi (count)
    if (totalCount >= 1)  milestoneUpdates['donorMilestones.1x']  = true;
    if (totalCount >= 5)  milestoneUpdates['donorMilestones.5x']  = true;

    // Badge berdasarkan total nominal
    if (totalAmount >= 10000)    milestoneUpdates['donorMilestones.10k']  = true;
    if (totalAmount >= 50000)    milestoneUpdates['donorMilestones.50k']  = true;
    if (totalAmount >= 100000)   milestoneUpdates['donorMilestones.100k'] = true;
    if (totalAmount >= 1000000)  milestoneUpdates['donorMilestones.1jt']  = true;

    if (Object.keys(milestoneUpdates).length === 0) {
      skipped++;
      continue;
    }

    const result = await User.findByIdAndUpdate(
      donorUserId,
      { $set: milestoneUpdates },
      { new: true }
    );

    if (result) {
      console.log(`✅ @${result.username} | donasi: ${totalCount}x | total: Rp${totalAmount.toLocaleString('id-ID')} | badge: ${Object.keys(milestoneUpdates).map(k => k.split('.')[1]).join(', ')}`);
      updated++;
    } else {
      console.warn(`⚠️  donorUserId ${donorUserId} tidak ditemukan di koleksi User — skip`);
      skipped++;
    }
  }

  console.log(`\n🎉 Selesai!`);
  console.log(`   Updated : ${updated} donor`);
  console.log(`   Skipped : ${skipped}`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected');
}

backfillDonorMilestones().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});