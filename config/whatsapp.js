// const { Client, LocalAuth } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');
// const { execSync } = require('child_process');

// // Auto-detect path chromium
// const getChromiumPath = () => {
//   const paths = [
//     '/usr/bin/chromium-browser',
//     '/usr/bin/chromium', 
//     '/usr/bin/google-chrome',
//     '/usr/bin/google-chrome-stable',
//     '/snap/bin/chromium',
//   ];
  
//   for (const p of paths) {
//     try {
//       execSync(`test -f ${p}`);
//       return p;
//     } catch {}
//   }
//   return null;
// };

// let client = null;
// let isReady = false;
// let qrCodeData = null;

// // Rate limit tracker
// const sendTracker = {
//   date: null,
//   count: 0,
//   MAX_PER_DAY: 50, // maksimal 50 pesan per hari
// };

// const initWhatsApp = () => {
//   const chromiumPath = getChromiumPath();
//   console.log('🔍 Chromium path:', chromiumPath || 'NOT FOUND');

//   if (client) {
//     console.log('[WA] Client sudah ada, skip re-init');
//     return client;
//   }

//   client = new Client({
//     authStrategy: new LocalAuth({
//       dataPath: './wa_session'
//     }),
//     puppeteer: {
//       headless: true,
//       ...(chromiumPath && { executablePath: chromiumPath }),
//       args: [
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-accelerated-2d-canvas',
//         '--no-first-run',
//         '--no-zygote',
//         '--single-process',
//         '--disable-gpu',
//         '--disable-extensions',
//         '--disable-background-networking',
//         '--disable-default-apps',
//         '--disable-sync',
//         '--disable-translate',
//         '--hide-scrollbars',
//         '--metrics-recording-only',
//         '--mute-audio',
//         '--no-first-run',
//         '--safebrowsing-disable-auto-update',
//       ]
//     }
//   });

//   client.on('qr', (qr) => {
//     qrCodeData = qr;
//     isReady = false;
//     qrcode.generate(qr, { small: true });
//     console.log('📱 QR Code generated, scan sekarang!');
//   });

//   client.on('loading_screen', (percent, message) => {
//     console.log('⏳ Loading WA:', percent, message);
//   });

//   client.on('authenticated', () => {
//     console.log('🔐 WA Authenticated!');
//   });

//   client.on('ready', () => {
//     isReady = true;
//     qrCodeData = null;
//     console.log('✅ WhatsApp siap!');
//   });

//   client.on('disconnected', (reason) => {
//     isReady = false;
//     qrCodeData = null;
//     console.log('❌ WA disconnect:', reason);
//     setTimeout(() => initWhatsApp(), 5000);
//   });

//   client.on('auth_failure', (msg) => {
//     isReady = false;
//     console.log('❌ Auth failure:', msg);
//     const fs = require('fs');
//     try {
//       fs.rmSync('./wa_session', { recursive: true, force: true });
//       console.log('🗑️ Session lama dihapus, akan generate QR baru');
//     } catch {}
//     setTimeout(() => initWhatsApp(), 3000);
//   });

//   client.initialize().catch(err => {
//     console.error('❌ WA init error:', err.message);
//   });

//   return client;
// };

// const waitUntilReady = (timeoutMs = 30000) => {
//   return new Promise((resolve, reject) => {
//     if (isReady) return resolve(true);
    
//     const timer = setTimeout(() => {
//       reject(new Error('WA timeout'));
//     }, timeoutMs);

//     const interval = setInterval(() => {
//       if (isReady) {
//         clearTimeout(timer);
//         clearInterval(interval);
//         resolve(true);
//       }
//     }, 500);
//   });
// };

// // Rate limit functions
// const canSendMessage = () => {
//   const today = new Date().toISOString().split('T')[0];
  
//   // Reset counter kalau hari baru
//   if (sendTracker.date !== today) {
//     sendTracker.date = today;
//     sendTracker.count = 0;
//   }

//   return sendTracker.count < sendTracker.MAX_PER_DAY;
// };

// const incrementSendCount = () => {
//   sendTracker.count++;
//   console.log(`[WA RateLimit] Pesan terkirim hari ini: ${sendTracker.count}/${sendTracker.MAX_PER_DAY}`);
// };

// const getSendStats = () => ({
//   date: sendTracker.date,
//   sent: sendTracker.count,
//   remaining: sendTracker.MAX_PER_DAY - sendTracker.count,
//   max: sendTracker.MAX_PER_DAY,
// });

// const getClient = () => client;
// const getIsReady = () => isReady;
// const getQRCode = () => qrCodeData;

// module.exports = { 
//   initWhatsApp, 
//   getClient, 
//   getIsReady, 
//   getQRCode, 
//   waitUntilReady,
//   canSendMessage,
//   incrementSendCount,
//   getSendStats
// };


// config/whatsapp.js - update dengan fix for Railway
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execSync } = require('child_process');
const fs = require('fs');

// Debug: Cek environment
console.log('🔍 Environment:', process.env);
console.log('🔍 Node version:', process.version);

// Auto-detect path chromium (termasuk Railway)
const getChromiumPath = () => {
  const paths = [
    // Railway specific
    process.env.CHROME_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/.nix/bin/chromium',
    '/app/.apt/usr/bin/chromium',
    // Google Chrome
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Snap (Jelastic)
    '/snap/bin/chromium',
  ];
  
  console.log('[WA] Checking chromium paths...');
  for (const p of paths) {
    if (!p) continue;
    try {
      fs.accessSync(p, fs.constants.X_OK);
      console.log('[WA] Found chromium:', p);
      return p;
    } catch {
      console.log('[WA] Not found:', p);
    }
  }
  return null;
};

let client = null;
let isReady = false;
let qrCodeData = null;

const sendTracker = {
  date: null,
  count: 0,
  MAX_PER_DAY: 50,
};

const initWhatsApp = () => {
  console.log('[WA] Starting initWhatsApp...');
  
  if (client) {
    console.log('[WA] Client sudah ada, skip re-init');
    return client;
  }

  const chromiumPath = getChromiumPath();
  console.log('[WA] Chromium path:', chromiumPath || 'NOT FOUND - akan coba tanpa指定path');

  // Lewati session jika bermasalah
  let sessionPath = './wa_session';
  try {
    fs.mkdirSync(sessionPath, { recursive: true });
  } catch (e) {
    console.log('[WA] Session path error:', e.message);
  }

  try {
    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionPath,
        clientId: 'dukungin-admin'
      }),
      puppeteer: {
        headless: true,
        executablePath: chromiumPath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          // Railway specific
          '--disable-web-security',
          '--unsafe-http-runtime-Origins=*',
          '--allow-running-insecure-content',
          '--ignore-certificate-errors',
          '--ignore-ssl-errors',
        ]
      }
    });

    client.on('qr', (qr) => {
      qrCodeData = qr;
      isReady = false;
      qrcode.generate(qr, { small: true });
      console.log('📱 QR Code generated! Scan dalam 30 detik!');
      console.log('📱 QR String first 100 chars:', qr.substring(0, 100));
    });

    client.on('ready', () => {
      isReady = true;
      qrCodeData = null;
      console.log('✅ WhatsApp TERHUBUNG!');
    });

    client.on('authenticated', () => {
      console.log('🔐 WA Authenticated!');
    });

    client.on('loading_screen', (percent, msg) => {
      console.log('⏳ Loading:', percent, msg);
    });

    client.on('disconnected', (reason) => {
      isReady = false;
      console.log('❌ WA disconnected:', reason);
      // Auto reconnect dengan delay
      setTimeout(() => {
        if (!isReady) {
          console.log('[WA] Attempting reconnect...');
          client = null;
          initWhatsApp();
        }
      }, 10000);
    });

    client.on('auth_failure', (msg) => {
      isReady = false;
      console.log('❌ Auth failure:', msg);
      // Hapus session dan try again
      try {
        fs.rmSync('./wa_session', { recursive: true, force: true });
      } catch {}
      setTimeout(() => {
        client = null;
        initWhatsApp();
      }, 5000);
    });

    client.on('change_state', (state) => {
      console.log('[WA] State change:', state);
    });

    client.on('new_session', () => {
      console.log('[WA] New session created!');
    });

    console.log('[WA] Initializing client...');
    client.initialize()
      .then(() => console.log('[WA] Client initialized successfully'))
      .catch(err => {
        console.error('[WA] Init error:', err.message);
        console.error('[WA] Stack:', err.stack);
      });

  } catch (err) {
    console.error('[WA] Setup error:', err.message);
    console.error('[WA] Stack:', err.stack);
  }

  return client;
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

const getClient = () => client;
const getIsReady = () => isReady;
const getQRCode = () => qrCodeData;
const waitUntilReady = (ms = 30000) => new Promise((resolve, reject) => {
  if (isReady) return resolve(true);
  const t = setTimeout(() => reject(new Error('WA timeout')), ms);
  const i = setInterval(() => { if (isReady) { clearTimeout(t); clearInterval(i); resolve(true); } }, 500);
});

module.exports = { 
  initWhatsApp, getClient, getIsReady, getQRCode, waitUntilReady,
  canSendMessage, incrementSendCount, getSendStats
};