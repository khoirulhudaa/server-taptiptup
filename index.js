// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/database');
const { donationQueue } = require('./utils/donationQueue'); // ← tambahkan ini

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  socket.on('join-room', (token) => {
    socket.join(token);
    console.log(`Client joined room: ${token}`);
  });

  socket.on('join-overlay', (token) => {
    socket.join(token);
    console.log(`Overlay joined room: ${token}`);
  });
});

app.use(cors());
app.use(express.json());
app.set('socketio', io);

// Routes
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

app.get('/testing', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running!', node_env: process.env.NODE_ENV });
});

app.use('/api/overlay',      overlayRoutes);
app.use('/api/midtrans',     midtransRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/donations',    donationRoutes);
app.use('/api/follows',      followRoutes);
app.use('/api/milestones',   milestoneRoutes);
app.use('/api/banned-words', bannedWordRoutes);
app.use('/widget',           widgetRoutes);
app.use('/api/subathon',     subathonRoutes);
app.use('/api/polls',        pollRoutes);

const PORT = process.env.PORT || 5101;

// ✅ connectDB dulu, baru recover queue, baru listen
connectDB().then(async () => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Recovery queue setelah server siap
  // Delay 2 detik agar socket.io siap menerima koneksi
  setTimeout(async () => {
    console.log('[Server] 🔄 Memulai recovery queue...');
    await donationQueue.recover(io);
  }, 2000);
});