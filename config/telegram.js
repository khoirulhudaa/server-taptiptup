// config/telegram.js
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = '8812242847:AAHzFUf_gkBa2Xtu1t3ZJOi_EhV0zkOh1xc';
const ADMIN_CHAT_ID = '1197980788';

const bot = new TelegramBot(TOKEN, { polling: false });

// Test connection
bot.getMe().then((me) => {
  console.log('[TG] Bot connected:', me.first_name);
}).catch((e) => {
  console.log('[TG] Error:', e.message);
});

// Kirim notifikasi
const sendTelegramNotification = async (message) => {
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log('[TG] ✅ Notifikasi terkirim!');
    return true;
  } catch (e) {
    console.log('[TG] Error:', e.message);
    return false;
  }
};

module.exports = { sendTelegramNotification };