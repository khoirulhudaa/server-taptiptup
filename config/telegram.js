// config/telegram.js
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = '8812242847:AAHzFUf_gkBa2Xtu1t3ZJOi_EhV0zkOh1xc';
const ADMIN_CHAT_ID = '1197980788';

let bot = null;
let isReady = false;

const initTelegram = () => {
  try {
    bot = new TelegramBot(TOKEN, { polling: false });
    isReady = true;
    console.log('[TG] ✅ Telegram Bot ready!');
    console.log('[TG] Chat ID:', ADMIN_CHAT_ID);
    
    // Send welcome message
    bot.sendMessage(ADMIN_CHAT_ID, '🎉 Bot Telegram Dukungin aktif!').catch(() => {});
  } catch (e) {
    console.log('[TG] Error:', e.message);
    isReady = false;
  }
};

const sendNotification = async (message) => {
  if (!bot || !isReady) {
    console.log('[TG] Bot not ready');
    return false;
  }
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    return true;
  } catch (e) {
    console.log('[TG] Error:', e.message);
    return false;
  }
};

module.exports = { initTelegram, sendNotification };