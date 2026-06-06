const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/database');
const { donationQueue, QueueItem } = require('./utils/donationQueue');
const { initTelegram, sendNotification } = require('./config/telegram');
const { sendWithdrawalNotification, sendDonationNotification } = require('./utils/telegramNotification');
const updateAvailableBalance = require('./cron/updateAvailableBalance');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// ==================== STATIC FILES (PENTING!) ====================
const publicPath = path.join(__dirname, 'public');

// Serve uploads folder
app.use('/uploads', express.static(path.join(publicPath, 'uploads'), {
  maxAge: '1d',                    // cache lebih lama
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Penting untuk menghindari ORB
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    if (mimeTypes[ext]) {
      res.set('Content-Type', mimeTypes[ext]);
    }
    
    res.set('Cache-Control', 'public, max-age=86400');
  }
}));

app.use('/temp-uploads', express.static(path.join(__dirname, 'temp-uploads')));
app.use(express.static(publicPath));

console.log('✅ Static files dengan CORS + ORB fix sudah aktif');
console.log('   Path:', path.join(publicPath, 'uploads'));
console.log('✅ Static files served:');
console.log('   → /uploads         →', path.join(publicPath, 'uploads'));
console.log('   → /uploads/images  → Profile Pictures');
console.log('   → /uploads/audio   → Audio Files');

io.on('connection', (socket) => {
  socket.on('join-room', async (token) => {
    socket.join(token);
    // console.log(`[Socket] Client join room: ${token}`);

    const pendingCount = await QueueItem.countDocuments({
      overlayToken: token,
      status: { $in: ['PENDING', 'PROCESSING'] },
    });

    if (pendingCount > 0) {
      console.log(`[Socket] OBS join — ada ${pendingCount} donasi pending`);
      await QueueItem.updateMany(
        { overlayToken: token, status: 'PROCESSING' },
        { $set: { status: 'PENDING' } }
      );

      // ✅ Tambah delay 1.5s agar socket benar-benar siap
      setTimeout(() => {
        if (!donationQueue.processing.get(token)) {
          donationQueue._processNext(token, io);
        }
      }, 1500);
    }
  });
});

// ==================== MIDDLEWARE ====================
app.set('socketio', io);

// ==================== ROUTES ====================
const overlayRoutes    = require('./routers/overlayRouter');
const midtransRoutes   = require('./routers/midtransRouter');
const authRoutes       = require('./routers/authRouter');
const donationRoutes   = require('./routers/donationRouter');
const followRoutes     = require('./routers/followRouter');
const milestoneRoutes  = require('./routers/milestoneRouter');
const bannedWordRoutes = require('./routers/bannedWordRouter');
const widgetRoutes     = require('./routers/widgetRouter');
const subathonRoutes   = require('./routers/subathonRouter');
const pollRoutes       = require('./routers/pollRouter');
const superAdminRoutes = require('./routers/superAdminRouter');
const testAlertRoutes  = require('./routers/testAlertRouter');
const voiceRoutes      = require('./routers/voiceRouter');
const waRoutes = require('./routers/waRouter');
const suggestionRoutes = require('./routers/suggestionRouter');
const youtubeCheckRoutes = require('./routers/youtubeCheck');
const streamerRoutes = require('./routers/streamerRouter');
const announcementRoutes = require('./routers/announcementRouter');
const transferRoutes = require('./routers/transferRouter');
const maintenanceRoutes = require('./routers/maintenanceRouter');
const streamerManageRoutes = require('./routers/streamerManagerRouter');
const disbursementRouter = require('./routers/disbursementRouter');
const dokuPaymentRouter = require('./routers/dokuPaymentRouter');

app.get('/testing', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running!', node_env: process.env.NODE_ENV });
});


app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/wa', waRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/midtrans',     midtransRoutes);
app.use('/api/disbursement', disbursementRouter);
app.use('/api/doku-payment', dokuPaymentRouter);
app.use('/api/youtube-check',      youtubeCheckRoutes);
app.use('/api/overlay',      overlayRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/superadmin',   superAdminRoutes);
app.use('/api/voice',        voiceRoutes);
app.use('/api/transfer',        transferRoutes);
app.use('/api/follows',      followRoutes);
app.use('/api/streamer-manage',      streamerManageRoutes);
app.use('/api/milestones',   milestoneRoutes);
app.use('/api/banned-words', bannedWordRoutes);
app.use('/api/donations',    donationRoutes);
app.use('/api/streamers', streamerRoutes);
app.use('/widget',           widgetRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/subathon',     subathonRoutes);
app.use('/api/polls',        pollRoutes);
app.use('/api/test-alert',   testAlertRoutes);

const PORT = process.env.PORT || 5101;
// ==================== START SERVER ====================
connectDB().then(async () => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  initTelegram();
  console.log('[Server] 🔄 WhatsApp bot dimulai...');

  // FIX 3: Jalankan updateAvailableBalance pertama kali HANYA SETELAH DB connect sukses
  try {
    await updateAvailableBalance();
    console.log('[Cron] Initial balance update successful');
  } catch (err) {
    console.error('[Cron] Failed initial balance update:', err.message);
  }

  // Set interval dipindah ke sini
  setInterval(updateAvailableBalance, 60 * 1000); 
  console.log('[Cron] Loop interval 1 menit diaktifkan');

  setTimeout(async () => {
    console.log('[Server] 🔄 Memulai recovery queue...');
    await donationQueue.recover(io);
  }, 2000);
}).catch(err => {
  console.error("❌ Database connection failed. Exiting...", err);
  process.exit(1);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received — graceful shutdown...');
  await QueueItem.updateMany(
    { status: 'PROCESSING' },
    { $set: { status: 'PENDING' } }
  ).catch(console.error);

  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 8000);
});