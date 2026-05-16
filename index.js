// // server.js
// require('dotenv').config();
// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
// const cors = require('cors');
// const connectDB = require('./config/database');
// const { donationQueue, QueueItem } = require('./utils/donationQueue');
// const path = require('path'); 

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: '*' },
// });

// io.on('connection', (socket) => {
//   socket.on('join-room', async (token) => {
//     socket.join(token);
//     console.log(`[Socket] Client join room: ${token}`);

//     const pendingCount = await QueueItem.countDocuments({
//       overlayToken: token,
//       status: { $in: ['PENDING', 'PROCESSING'] },
//     });

//     if (pendingCount > 0) {
//       console.log(`[Socket] OBS join — ada ${pendingCount} donasi pending, lanjutkan queue`);

//       await QueueItem.updateMany(
//         { overlayToken: token, status: 'PROCESSING' },
//         { $set: { status: 'PENDING' } }
//       );

//       if (!donationQueue.processing.get(token)) {
//         donationQueue._processNext(token, io);
//       }
//     }
//   });
// });

// app.use(cors());
// app.use(express.json());
// app.set('socketio', io);
// // app.js - TAMBAH INI
// app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
// app.use('/uploads/audio', express.static(path.join(__dirname, 'public/uploads/audio')));
// app.use('/uploads/audio', express.static(path.join(__dirname, 'uploads/audio'), {
//   maxAge: '1h',
//   setHeaders: (res, path) => {
//     res.set('Access-Control-Allow-Origin', '*');
//     res.set('Cache-Control', 'public, max-age=3600');
//   }
// }));

// console.log('✅ Audio uploads served at /uploads/audio');

// // Routes
// const overlayRoutes    = require('./routers/overlayRouter');
// const midtransRoutes   = require('./routers/midtransRouter');
// const authRoutes       = require('./routers/authRouter');
// const donationRoutes   = require('./routers/donationRouter');
// const followRoutes     = require('./routers/followRouter');
// const milestoneRoutes  = require('./routers/milestoneRouter');
// const bannedWordRoutes = require('./routers/bannedWordRouter');
// const widgetRoutes     = require('./routers/widgetRouter');
// const subathonRoutes   = require('./routers/subathonRouter');
// const pollRoutes       = require('./routers/pollRouter');
// const testAlertRoutes = require('./routers/testAlertRouter');
// const voiceRoutes = require('./routers/voiceRouter');


// app.get('/testing', (req, res) => {
//   res.json({ status: 'OK', message: 'Server is running!', node_env: process.env.NODE_ENV });
// });

// app.use('/api/overlay',      overlayRoutes);
// app.use('/api/midtrans',     midtransRoutes);
// app.use('/api/auth',         authRoutes);
// app.use('/api/donations',    donationRoutes);
// app.use('/api/voice', voiceRoutes);
// app.use('/api/follows',      followRoutes);
// app.use('/api/milestones',   milestoneRoutes);
// app.use('/api/banned-words', bannedWordRoutes);
// app.use('/widget',           widgetRoutes);
// app.use('/api/subathon',     subathonRoutes);
// app.use('/api/polls',        pollRoutes);
// app.use('/api/test-alert', testAlertRoutes);

// const PORT = process.env.PORT || 5101;

// connectDB().then(async () => {
//   server.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//   });

//   setTimeout(async () => {
//     console.log('[Server] 🔄 Memulai recovery queue...');
//     await donationQueue.recover(io);
//   }, 2000);
// });

// process.on('SIGTERM', async () => {
//   console.log('[Server] SIGTERM received — graceful shutdown...');

//   await QueueItem.updateMany(
//     { status: 'PROCESSING' },
//     { $set: { status: 'PENDING' } }
//   ).catch(console.error);

//   console.log('[Server] Queue PROCESSING → PENDING, siap restart');

//   server.close(() => {
//     console.log('[Server] HTTP server closed');
//     process.exit(0);
//   });

//   setTimeout(() => process.exit(0), 8000);
// });


// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const connectDB = require('./config/database');
const { donationQueue, QueueItem } = require('./utils/donationQueue');

const app = express();
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
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      res.set('Content-Type', `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`);
    }
    
    res.set('Cache-Control', 'public, max-age=86400');
  }
}));

// Optional: Serve entire public folder
app.use(express.static(publicPath));

console.log('✅ Static files dengan CORS + ORB fix sudah aktif');
console.log('   Path:', path.join(publicPath, 'uploads'));
console.log('✅ Static files served:');
console.log('   → /uploads         →', path.join(publicPath, 'uploads'));
console.log('   → /uploads/images  → Profile Pictures');
console.log('   → /uploads/audio   → Audio Files');

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  socket.on('join-room', async (token) => {
    socket.join(token);
    console.log(`[Socket] Client join room: ${token}`);

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
      if (!donationQueue.processing.get(token)) {
        donationQueue._processNext(token, io);
      }
    }
  });
});

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
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
const testAlertRoutes  = require('./routers/testAlertRouter');
const voiceRoutes      = require('./routers/voiceRouter');

app.get('/testing', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running!', node_env: process.env.NODE_ENV });
});

app.use('/api/overlay',      overlayRoutes);
app.use('/api/midtrans',     midtransRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/donations',    donationRoutes);
app.use('/api/voice',        voiceRoutes);
app.use('/api/follows',      followRoutes);
app.use('/api/milestones',   milestoneRoutes);
app.use('/api/banned-words', bannedWordRoutes);
app.use('/widget',           widgetRoutes);
app.use('/api/subathon',     subathonRoutes);
app.use('/api/polls',        pollRoutes);
app.use('/api/test-alert',   testAlertRoutes);

const PORT = process.env.PORT || 5101;

connectDB().then(async () => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  setTimeout(async () => {
    console.log('[Server] 🔄 Memulai recovery queue...');
    await donationQueue.recover(io);
  }, 2000);
});

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