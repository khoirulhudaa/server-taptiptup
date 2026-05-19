// cron/updateAvailableBalance.js
const mongoose = require('mongoose');
const { User, Donation } = require('../models');

/**
 * Cron ini dijalankan setiap 1 jam / 1 menit
 * Fungsi: Cek donasi yang sudah > 24 jam dan update availableBalance user
 */
async function updateAvailableBalance() {
  try {
    console.log('[Cron] Running updateAvailableBalance...');
    
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 jam lalu

    // Cari donasi yang status PAID dan createdAt > 24 jam lalu, tapi availableAt masih null
    const pendingDonations = await Donation.find({
      status: 'PAID',
      availableAt: null,
      createdAt: { $lte: oneDayAgo } // sudah lebih dari 24 jam
    });

    console.log(`[Cron] Found ${pendingDonations.length} donations to release`);

    for (const donation of pendingDonations) {
      // Update user balance
      await User.findByIdAndUpdate(donation.userId, {
        $inc: { availableBalance: donation.amount }
      });

      // Tandai donasi ini sudah di-track
      donation.availableAt = new Date();
      await donation.save();
    }

    console.log('[Cron] Done updating available balances');
  } catch (err) {
    console.error('[Cron] Error updateAvailableBalance:', err);
  }
}

module.exports = updateAvailableBalance;