// config/whatsapp.js - FIXED QR DISPLAY
const { 
  makeWASocket, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  delay 
} = require('baileys');
const fs = require('fs');
const path = require('path');

let sock = null;
let isReady = false;
let qrCode = null;

const sendTracker = { date: null, count: 0, MAX_PER_DAY: 50 };

const initWhatsApp = async () => {
  console.log('[WA] Starting Baileys with QR...');
  
  if (sock && isReady) {
    console.log('[WA] Already connected!');
    return sock;
  }

  try {
    const sessionDir = './wa_session_baileys';
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log('[WA] Has creds?', !!state.creds?.me?.id);

    sock = makeWASocket({
      version,
      auth: state,
      browser: ['Dukungin Server', 'Chrome', '120'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;
      
      console.log('[WA] Conn:', connection);
      
      // ✅ PRINT QR CODE!
      if (qr) {
        qrCode = qr;
        console.log('\n========================================');
        console.log('📱 QR CODE (scan dalam 30 detik):');
        console.log('========================================');
        console.log(qr);  // ⬅️ PRINT HERE!
        console.log('========================================');
        console.log('📱 Atau buka WhatsApp → Settings → Linked Devices\n');
      }
      
      if (connection === 'open') {
        isReady = true;
        qrCode = null;
        console.log('\n✅✅ WhatsApp TERHUBUNG! ✅✅\n');
      }
    });

    console.log('[WA] Waiting 15s...');
    for (let i = 0; i < 15; i++) {
      await delay(1000);
    }

    if (!state.creds?.me?.id && !isReady) {
      console.log('[WA] Asking for QR...');
    }

    console.log('[WA] Waiting for connection...');
    for (let i = 0; i < 120; i++) {
      await delay(1000);
      
      if (qrCode) {
        console.log(`[WA] still waiting... ${i}s - QR ready! Scan now!`);
      }
      if (isReady) {
        console.log('[WA] ✅ Connected!', i, 's');
        break;
      }
    }

    if (isReady) {
      console.log('✅✅ WhatsApp SIAP! ✅✅');
    }
    
    return sock;
    
  } catch (err) {
    console.error('[WA] Error:', err.message);
    return null;
  }
};

// Exports
const canSendMessage = () => {
  const today = new Date().toISOString().split('T')[0];
  if (sendTracker.date !== today) {
    sendTracker.date = today;
    sendTracker.count = 0;
  }
  return sendTracker.count < sendTracker.MAX_PER_DAY;
};

const incrementSendCount = () => sendTracker.count++;

const getSendStats = () => ({
  sent: sendTracker.count,
  remaining: sendTracker.MAX_PER_DAY - sendTracker.count,
  max: sendTracker.MAX_PER_DAY,
});

const getClient = () => sock;
const getIsReady = () => isReady;
const getQRCode = () => qrCode;

const waitUntilReady = (ms = 120000) => new Promise((resolve, reject) => {
  if (isReady) return resolve(true);
  const t = setTimeout(() => reject(new Error('WA timeout')), ms);
  const i = setInterval(() => { if (isReady) { clearTimeout(t); clearInterval(i); resolve(true); } }, 1000);
});

const sendMessage = async (phone, text) => {
  if (!sock || !isReady) throw new Error('WA not connected');
  const jid = phone.replace('@s.whatsapp.net', '') + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text });
  incrementSendCount();
};

module.exports = { 
  initWhatsApp, getClient, getIsReady, getQRCode, waitUntilReady,
  canSendMessage, incrementSendCount, getSendStats, sendMessage
};