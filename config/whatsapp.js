const { 
  makeWASocket, 
  useMultiFileAuthState, 
  disconnectSocket 
} = require('baileys');
const fs = require('fs');
const path = require('path');

let sock = null;
let isReady = false;

// Rate limit
const sendTracker = { date: null, count: 0, MAX_PER_DAY: 50 };

const initWhatsApp = async () => {
  console.log('[WA] Starting Baileys WhatsApp...');
  
  if (sock && isReady) {
    console.log('[WA] Already connected!');
    return sock;
  }

  try {
    // Load session dari file
    const sessionDir = './wa_session_baileys';
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    sock = makeWASocket({
      auth: state,
      print: (msg) => console.log('[WA]', msg),
      browser: ['Dukungin Bot', 'Chrome', '120'],
    });

    // Simpan creds kalo berubah
    sock.ev.on('creds.update', saveCreds);

    // Connection handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'open') {
        isReady = true;
        console.log('✅ WhatsApp TERHUBUNG!');
      } else if (connection === 'close') {
        isReady = false;
        console.log('❌ WA disconnected:', lastDisconnect?.error);
        // Auto reconnect
        setTimeout(() => { sock = null; initWhatsApp(); }, 5000);
      }
    });

    // Wait sampai connected
    let attempts = 0;
    while (!isReady && attempts < 30) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
      console.log('[WA] Waiting for connection...', attempts);
    }

    if (!isReady) {
      console.log('[WA] ❌ Connection timeout!');
    }

    return sock;
    
  } catch (err) {
    console.error('[WA] Init error:', err.message);
    return null;
  }
};

const canSendMessage = () => {
  const today = new Date().toISOString().split('T')[0];
  if (sendTracker.date !== today) {
    sendTracker.date = today;
    sendTracker.count = 0;
  }
  return sendTracker.count < sendTracker.MAX_PER_DAY;
};

const incrementSendCount = () => {
  sendTracker.count++;
  console.log(`[WA] Sent: ${sendTracker.count}/${sendTracker.MAX_PER_DAY}`);
};

const getSendStats = () => ({
  date: sendTracker.date,
  sent: sendTracker.count,
  remaining: sendTracker.MAX_PER_DAY - sendTracker.count,
  max: sendTracker.MAX_PER_DAY,
});

const getClient = () => sock;
const getIsReady = () => isReady;
const getQRCode = () => null;  // Baileys tidak perlu QR code manual

const waitUntilReady = (ms = 30000) => new Promise((resolve, reject) => {
  if (isReady) return resolve(true);
  const t = setTimeout(() => reject(new Error('WA timeout')), ms);
  const i = setInterval(() => { if (isReady) { clearTimeout(t); clearInterval(i); resolve(true); } }, 500);
});

const sendMessage = async (phone, message) => {
  if (!sock || !isReady) {
    throw new Error('WhatsApp not connected');
  }
  
  const jid = phone + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text: message });
  incrementSendCount();
};

module.exports = { 
  initWhatsApp, getClient, getIsReady, getQRCode, waitUntilReady,
  canSendMessage, incrementSendCount, getSendStats, sendMessage
};