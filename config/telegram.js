// config/telegram.js - FINAL
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = '8868652249:AAF5tSvIIw728jcaroZ0WEWmEAsA7Nd_7v0';
const ADMIN_CHAT_ID = '1197980788';  // ⬅️ Benar!

let bot = null;
let isReady = false;

const initTelegram = () => {
  try {
    bot = new TelegramBot(TOKEN, { polling: false });
    isReady = true;
    console.log('[TG] ✅ Telegram Bot ready!');
    console.log('[TG] Chat ID:', ADMIN_CHAT_ID);
    
    // Send welcome
    bot.sendMessage(ADMIN_CHAT_ID, '🎉 Bot Aktif! Notifikasi siap.').catch(() => {});
  } catch (e) {
    console.log('[TG] Error:', e.message);
    isReady = false;
  }
};

const sendNotification = async (message) => {
  if (!bot || !isReady) return false;
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    return true;
  } catch (e) {
    console.log('[TG] Error:', e.message);
    return false;
  }
};

module.exports = { initTelegram, sendNotification };