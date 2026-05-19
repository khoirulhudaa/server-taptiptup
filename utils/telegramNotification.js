// // utils/whatsappNotification.js
// const { getClient, getIsReady, waitUntilReady, sendMessage } = require('../config/whatsapp');

// const ADMIN_WA_NUMBER = '6289513093406';  // Format: 62xxx (tanpa +)

// const sendWithdrawalNotification = async (data) => {
//   try {
//     await waitUntilReady(30000);
    
//     if (!getIsReady()) {
//       console.log('[WA] ❌ WA not ready');
//       return false;
//     }

//     const message = `🔔 *PERMINTAAN PENARIKAN BARU*

// 👤 Streamer: @${data.username}
// 💰 Jumlah: Rp ${formatRupiah(data.amount)}
// 🏦 Metode: ${data.paymentMethod}
// 🏛️ Bank: ${data.channelCode}
// 🔢 Rekening: ${data.accountNumber}
// � Nama: ${data.accountName}

// ⏰ ${new Date().toLocaleString('id-ID')}`;

//     await sendMessage(ADMIN_WA_NUMBER, message);
//     console.log(`[WA] ✅ Notifikasi terkirim!`);
//     return true;
//   } catch (err) {
//     console.error('[WA] Error:', err.message);
//     return false;
//   }
// };


// utils/whatsappNotification.js → rename ke telegramNotification.js
const { sendTelegramNotification } = require('../config/telegram');

const formatRupiah = (num) => new Intl.NumberFormat('id-ID').format(Math.round(num));

const sendWithdrawalNotification = async (data) => {
  const message = `🔔 *PERMINTAAN PENARIKAN*

👤 Streamer: @${data.username}
💰 Jumlah: Rp ${formatRupiah(data.amount)}
🏦 Metode: ${data.paymentMethod}
🏛️ Bank: ${data.channelCode}
🔢 Rekening: ${data.accountNumber}
👤 Nama: ${data.accountName}

⏰ ${new Date().toLocaleString('id-ID')}`;

  return await sendTelegramNotification(message);
};

const sendDonationNotification = async (data) => {
  const message = `💖 *DONASI MASUK*

👤 Donor: ${data.donorName}
💰 Jumlah: Rp ${formatRupiah(data.amount)}
🎁 Untuk: @${data.streamerUsername}
${data.message ? `💬 Pesan: ${data.message}` : ''}

⏰ ${new Date().toLocaleString('id-ID')}`;

  return await sendTelegramNotification(message);
};

module.exports = {
  sendWithdrawalNotification,
  sendDonationNotification
};